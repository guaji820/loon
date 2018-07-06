import * as express from 'express'
import * as _ from 'lodash'
import { IHandlerAdapter, ILoaderAdapter } from "./IAdapter";
import { ConverterService } from '../converter/ConverterService'
import { HandlerParamMetadata } from '../mvc/HandlerParamMetadata'
import { MiddlewareRegistry } from '../mvc/MiddlewareRegistry'
import { HandlerExecutor } from '../mvc/HandlerExecutor'
import { ControllerRegistry } from '../mvc/ControllerRegistry'

export class ExpressHandlerAdapter implements IHandlerAdapter {

  private _converter: ConverterService

  constructor(converter: ConverterService) {
    this._converter = converter
  }

  getPathFromRequest(req: express.Request, param: HandlerParamMetadata) {
    const path = _.get(req.params, param.expression)
    return this._converter.convert(path, param.returnType)
  }

  getBodyFromRequest(req: express.Request, param: HandlerParamMetadata) {
    const body = _.get(req.body, param.expression)
    return this._converter.convert(body, param.returnType)
  }

  getQueryFromRequest(req: express.Request, param: HandlerParamMetadata) {
    const query = _.get(req.query, param.expression)
    return this._converter.convert(query, param.returnType)
  }

  getHeaderFromRequest(req: express.Request, param: HandlerParamMetadata) {
    const header = _.get(req.headers, param.expression) 
    // header value should always be string, ignore the converter here
    return header
  }  
}

export class ExpressLoaderAdapter implements ILoaderAdapter {

  private _server: express.Application
  private _adapter: IHandlerAdapter

  constructor(server: express.Application, adapter: IHandlerAdapter) {
    this._server = server
    this._adapter = adapter
  }
  
  loadMiddlewares() {
    MiddlewareRegistry
      .getMiddlewares({isErrorMiddleware: false})
      .forEach(middlewareMetadata => {
        const handlerMetadata = middlewareMetadata.handler;
        const middleware = (req, res, next) => {
          HandlerExecutor.run(this._adapter, handlerMetadata, {req, res, next})
        }
        this._server.use(middleware)
      })
  }

  loadControllers() {

    ControllerRegistry.controllers.forEach(controllerMetadata => {
      // register a controller as a fastify plugin
      const controller = express.Router()

      controllerMetadata.handlers.forEach(handlerMetadata => {

        function registerFilter(filterName) {
          const store: any[] = []
          const actionName = handlerMetadata.actionName
          controllerMetadata[filterName].forEach(controllerFilterMetadata => {
            if (
              (controllerFilterMetadata.only && controllerFilterMetadata.only.indexOf(actionName) === -1) || 
              (controllerFilterMetadata.except && controllerFilterMetadata.except.indexOf(actionName) > -1) ||
              controllerFilterMetadata
            ) {
              const filter = (req, res, next) => {
                HandlerExecutor.run(this._adapter, controllerFilterMetadata.filterMetadata.handler, {req, res})
                next()
              }
              store.push(filter)
            }
          })
          return store
        }

        const beforeFilters = registerFilter('beforeFilters')
        const afterFilters = registerFilter('afterFilters')

        // register controller action
        handlerMetadata.httpMethodAndPaths.forEach(httpMethodAndPath => {
          const handler = (req, res) => {
            HandlerExecutor.run(this._adapter, handlerMetadata, {req, res})
          }
          controller[httpMethodAndPath.method](httpMethodAndPath.path, ...beforeFilters, handler, ...afterFilters)
        })

      })

      this._server.use(controllerMetadata.baseUrl, controller)
    })
  }

  loadErrorMiddlewares() {
    MiddlewareRegistry
      .getMiddlewares({isErrorMiddleware: true})
      .forEach(middlewareMetadata => {
        const handlerMetadata = middlewareMetadata.handler;
        const errorHandler = (err, req, res, next) => {
          HandlerExecutor.run(this._adapter, handlerMetadata, {req, res, err, next})
        }
        this._server.use(errorHandler)
      })
  }
} 