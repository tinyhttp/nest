import {
  InternalServerErrorException,
  Logger,
  RequestMethod,
  NestApplicationOptions,
  VersioningType
} from '@nestjs/common'
import { RawBodyRequest, VersioningOptions, VersionValue, VERSION_NEUTRAL } from '@nestjs/common/interfaces'
import { RouterMethodFactory } from '@nestjs/core/helpers/router-method-factory'
import { isString, isUndefined } from '@nestjs/common/utils/shared.utils'
import {
  json as bodyParserJson,
  Options,
  OptionsJson,
  OptionsUrlencoded,
  urlencoded as bodyParserUrlencoded
} from 'body-parser'
import { cors } from '@tinyhttp/cors'
import * as http from 'http'
import * as https from 'https'
import { App, Response, Request } from '@tinyhttp/app'
import { AbstractHttpAdapter } from '@nestjs/core'
import { default as sirv, Options as SirvOptions } from 'sirv'
import { Duplex } from 'stream'

export interface ServeStaticOptions extends SirvOptions {
  prefix?: string
}

export type VersionedRoute = <TRequest extends Record<string, any> = any, TResponse = any>(
  req: TRequest,
  res: TResponse,
  next: () => void
) => any

export class TinyHttpAdapter extends AbstractHttpAdapter {
  private readonly routerMethodFactory = new RouterMethodFactory()
  private readonly openConnections = new Set<Duplex>()
  constructor(instance?: any) {
    super(instance ?? new App())
  }

  public reply(response: Response, body: any, statusCode?: number) {
    if (statusCode) {
      response.status(statusCode)
    }
    return response.send(body)
  }

  public status(response: Response, statusCode: number) {
    return response.status(statusCode)
  }

  public end(response: Response, message?: string) {
    return response.end(message)
  }

  public render(response: Response, view: string, options: any) {
    return response.render(view, options)
  }

  public redirect(response: Response, statusCode: number, url: string) {
    return response.redirect(url, statusCode)
  }

  public setErrorHandler(handler: Function, prefix?: string) {
    return this.use(handler)
  }

  public setNotFoundHandler(handler: Function, prefix?: string) {
    return this.use(handler)
  }

  public isHeadersSent(response: Response): boolean {
    return response.headersSent
  }

  public setHeader(response: Response, name: string, value: string) {
    return response.setHeader(name, value)
  }

  public listen(port: string | number, callback?: () => void)
  public listen(port: string | number, hostname: string, callback?: () => void)
  public listen(port: any, ...args: any[]) {
    return this.httpServer.listen(port, ...args)
  }
  public close() {
    if (!this.httpServer) {
      return undefined
    }
    return new Promise((resolve) => this.httpServer.close(resolve))
  }
  public set(...args: any[]) {
    return this.instance.set(...args)
  }

  public enable(...args: any[]) {
    return this.instance.enable(...args)
  }

  public disable(...args: any[]) {
    return this.instance.disable(...args)
  }

  public engine(...args: any[]) {
    return this.instance.engine(...args)
  }

  public useStaticAssets(path: string, options: ServeStaticOptions) {
    const serve = sirv(path, options)
    if (options?.prefix) {
      return this.use(options.prefix, serve)
    }

    return this.use(serve)
  }

  public setBaseViewsDir(path: string | string[]) {
    return this.set('views', path)
  }

  public setViewEngine(engine: string) {
    return this.set('view engine', engine)
  }

  public getRequestHostname(req: Request) {
    return req.hostname
  }

  public getRequestMethod(request: Request) {
    return request.method
  }

  public getRequestUrl(request: Request) {
    return request.originalUrl
  }

  public enableCors(options: any) {
    return this.use(cors(options))
  }

  public createMiddlewareFactory(requestMethod: RequestMethod): (path: string, callback: Function) => any {
    return this.routerMethodFactory.get(this.instance, requestMethod).bind(this.instance)
  }

  public initHttpServer(options: NestApplicationOptions) {
    const isHttpsEnabled = options && options.httpsOptions
    if (isHttpsEnabled) {
      this.httpServer = https.createServer(options.httpsOptions, this.getInstance())
    } else {
      this.httpServer = http.createServer(this.getInstance())
    }

    if (options?.forceCloseConnections) {
      this.trackOpenConnections()
    }
  }

  private trackOpenConnections() {
    this.httpServer.on('connection', (socket: Duplex) => {
      this.openConnections.add(socket)

      socket.on('close', () => this.openConnections.delete(socket))
    })
  }

  private closeOpenConnections() {
    for (const socket of this.openConnections) {
      socket.destroy()
      this.openConnections.delete(socket)
    }
  }

  public registerParserMiddleware(prefix?: string, rawBody?: boolean) {
    const bodyParserJsonOptions = this.getBodyParserOptions<OptionsJson>(rawBody)
    const bodyParserUrlencodedOptions = this.getBodyParserOptions<OptionsUrlencoded>(rawBody, { extended: true })

    const parserMiddleware = {
      jsonParser: bodyParserJson(bodyParserJsonOptions),
      urlencodedParser: bodyParserUrlencoded(bodyParserUrlencodedOptions)
    }
    Object.keys(parserMiddleware).forEach((parserKey) => this.use(parserMiddleware[parserKey]))
  }

  getType(): string {
    return 'tinyhttp'
  }

  public setLocal(key: string, value: any) {
    this.instance.locals[key] = value
    return this
  }

  public applyVersionFilter(
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions
  ): VersionedRoute {
    const callNextHandler: VersionedRoute = (req, res, next) => {
      if (!next) {
        throw new InternalServerErrorException('HTTP adapter does not support filtering on version')
      }
      return next()
    }

    if (
      version === VERSION_NEUTRAL ||
      // URL Versioning is done via the path, so the filter continues forward
      versioningOptions.type === VersioningType.URI
    ) {
      const handlerForNoVersioning: VersionedRoute = (req, res, next) => handler(req, res, next)

      return handlerForNoVersioning
    }

    // Custom Extractor Versioning Handler
    if (versioningOptions.type === VersioningType.CUSTOM) {
      const handlerForCustomVersioning: VersionedRoute = (req, res, next) => {
        const extractedVersion = versioningOptions.extractor(req)

        if (Array.isArray(version)) {
          if (Array.isArray(extractedVersion) && version.filter((v) => extractedVersion.includes(v as string)).length) {
            return handler(req, res, next)
          }

          if (isString(extractedVersion) && version.includes(extractedVersion)) {
            return handler(req, res, next)
          }
        } else if (isString(version)) {
          // Known bug here - if there are multiple versions supported across separate
          // handlers/controllers, we can't select the highest matching handler.
          // Since this code is evaluated per-handler, then we can't see if the highest
          // specified version exists in a different handler.
          if (Array.isArray(extractedVersion) && extractedVersion.includes(version)) {
            return handler(req, res, next)
          }

          if (isString(extractedVersion) && version === extractedVersion) {
            return handler(req, res, next)
          }
        }

        return callNextHandler(req, res, next)
      }

      return handlerForCustomVersioning
    }

    // Media Type (Accept Header) Versioning Handler
    if (versioningOptions.type === VersioningType.MEDIA_TYPE) {
      const handlerForMediaTypeVersioning: VersionedRoute = (req, res, next) => {
        const MEDIA_TYPE_HEADER = 'Accept'
        const acceptHeaderValue: string | undefined =
          req.headers?.[MEDIA_TYPE_HEADER] || req.headers?.[MEDIA_TYPE_HEADER.toLowerCase()]

        const acceptHeaderVersionParameter = acceptHeaderValue ? acceptHeaderValue.split(';')[1] : undefined

        // No version was supplied
        if (isUndefined(acceptHeaderVersionParameter)) {
          if (Array.isArray(version)) {
            if (version.includes(VERSION_NEUTRAL)) {
              return handler(req, res, next)
            }
          }
        } else {
          const headerVersion = acceptHeaderVersionParameter.split(versioningOptions.key)[1]

          if (Array.isArray(version)) {
            if (version.includes(headerVersion)) {
              return handler(req, res, next)
            }
          } else if (isString(version)) {
            if (version === headerVersion) {
              return handler(req, res, next)
            }
          }
        }

        return callNextHandler(req, res, next)
      }

      return handlerForMediaTypeVersioning
    }

    // Header Versioning Handler
    if (versioningOptions.type === VersioningType.HEADER) {
      const handlerForHeaderVersioning: VersionedRoute = (req, res, next) => {
        const customHeaderVersionParameter: string | undefined =
          req.headers?.[versioningOptions.header] || req.headers?.[versioningOptions.header.toLowerCase()]

        // No version was supplied
        if (isUndefined(customHeaderVersionParameter)) {
          if (Array.isArray(version)) {
            if (version.includes(VERSION_NEUTRAL)) {
              return handler(req, res, next)
            }
          }
        } else {
          if (Array.isArray(version)) {
            if (version.includes(customHeaderVersionParameter)) {
              return handler(req, res, next)
            }
          } else if (isString(version)) {
            if (version === customHeaderVersionParameter) {
              return handler(req, res, next)
            }
          }
        }

        return callNextHandler(req, res, next)
      }

      return handlerForHeaderVersioning
    }
  }

  getBodyParserOptions<ParserOptions extends Options>(
    rawBody: boolean,
    options?: ParserOptions | undefined
  ): ParserOptions {
    let parserOptions: ParserOptions = options ?? ({} as ParserOptions)

    const rawBodyParser = (req: RawBodyRequest<http.IncomingMessage>, _res: http.ServerResponse, buffer: Buffer) => {
      if (Buffer.isBuffer(buffer)) {
        req.rawBody = buffer
      }
      return true
    }

    if (rawBody === true) {
      parserOptions = {
        ...parserOptions,
        verify: rawBodyParser
      }
    }

    return parserOptions
  }
}
