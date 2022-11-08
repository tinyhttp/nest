import {
  InternalServerErrorException,
  Logger,
  RequestMethod,
  NestApplicationOptions,
  VersioningType,
} from '@nestjs/common';
import {
  VersioningOptions,
  VersionValue,
  VERSION_NEUTRAL
} from '@nestjs/common/interfaces';
import {
  CorsOptions,
  CorsOptionsDelegate
} from '@nestjs/common/interfaces/external/cors-options.interface';
import { RouterMethodFactory } from '@nestjs/core/helpers/router-method-factory';
import {
  isString, isUndefined
} from '@nestjs/common/utils/shared.utils';
import { json, urlencoded } from 'body-parser';
import cors from 'cors'
import * as http from 'http';
import * as https from 'https';
import { App, Response, Request } from '@tinyhttp/app'
import { AbstractHttpAdapter } from '@nestjs/core';
import { default as sirv, Options as SirvOptions } from 'sirv';

export interface SirvNestOptions extends SirvOptions {
  prefix?: string;
}

export type VersionedRoute = <
  TRequest extends Record<string, any> = any,
  TResponse = any,
>(
  req: TRequest,
  res: TResponse,
  next: () => void,
) => any;


export class TinyHttpAdapter extends AbstractHttpAdapter {
  private readonly routerMethodFactory = new RouterMethodFactory();
  private readonly logger = new Logger(TinyHttpAdapter.name);

  constructor(instance?: any) {
    super(instance ?? new App())
  }

  public reply(response: Response, body: any, statusCode?: number) {
    if (statusCode) {
      response.status(statusCode);
    }
    return response.send(body);
  }



  public status(response: Response, statusCode: number) {
    return response.status(statusCode);
  }

  public end(response: Response, message?: string) {
    return response.end(message);
  }

  public render(response: Response, view: string, options: any) {
    throw new Error("Method not implemented.");
  }


  public redirect(response: Response, statusCode: number, url: string) {
    return response.redirect(url, statusCode);
  }

  public setErrorHandler(handler: Function, prefix?: string) {
    if (prefix) {
      return this.use(prefix, handler);
    }

    return this.use(handler);
  }


  public setNotFoundHandler(handler: Function, prefix?: string) {
    if (prefix) {
      return this.use(prefix, handler);
    }

    return this.use(handler);
  }

  public isHeadersSent(response: Response): boolean {
    return response.headersSent;
  }

  public setHeader(response: Response, name: string, value: string) {
    return response.setHeader(name, value);
  }

  public listen(port: string | number, callback?: () => void);
  public listen(port: string | number, hostname: string, callback?: () => void);
  public listen(port: any, ...args: any[]) {
    return this.httpServer.listen(port, ...args);
  }
  public close() {
    if (!this.httpServer) {
      return undefined;
    }
    return new Promise(resolve => this.httpServer.close(resolve));
  }
  public set(...args: any[]) {
    throw new Error("Method not implemented.");
  }

  public enable(...args: any[]) {
    throw new Error("Method not implemented.");
  }

  public disable(...args: any[]) {
    throw new Error("Method not implemented.");
  }

  public engine(...args: any[]) {
    throw new Error("Method not implemented.");
  }


  public useStaticAssets(path: string, options: SirvNestOptions) {
    const serve = sirv(path, options);
    if (options?.prefix) {
      return this.use(options.prefix, serve);
    }

    return this.use(serve);
  }


  public setViewEngine(engine: string) {
    throw new Error("Method not implemented.");
  }



  public getRequestHostname(req: Request) {
    return req.hostname;
  }

  public getRequestMethod(request: Request) {
    return request.method;
  }

  public getRequestUrl(request: Request) {
    return request.originalUrl;
  }


  public enableCors(options: CorsOptions | CorsOptionsDelegate<any>) {
    let mw = cors(options);
    return this.use(mw);
  }


  public createMiddlewareFactory(
    requestMethod: RequestMethod,
  ): (path: string, callback: Function) => any {

    return this.routerMethodFactory.get(this.instance, requestMethod).bind(this.instance);
  }


  public initHttpServer(options: NestApplicationOptions) {
    const isHttpsEnabled = options.httpsOptions;
    if (isHttpsEnabled) {
      this.httpServer = https.createServer(
        options.httpsOptions,
        this.getInstance().handler,
      );
      return;
    }
    this.httpServer = http.createServer(this.getInstance().handler);

    this.getInstance().server = this.httpServer;
  }

  public registerParserMiddleware(prefix?: string, rawBody?: boolean) {
    if (prefix) {
      this.use(prefix, json);
      return this.use(prefix, urlencoded({ extended: true }));
    }

    this.use(json);
    this.use(urlencoded({ extended: true }));
  }



  getType(): string {
    return 'tinyhttp';
  }

  public setLocal(key: string, value: any) {
    this.instance.locals[key] = value;
    return this;
  }


  public applyVersionFilter(
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions,
  ): VersionedRoute {
    const callNextHandler: VersionedRoute = (req, res, next) => {
      if (!next) {
        throw new InternalServerErrorException(
          'HTTP adapter does not support filtering on version',
        );
      }
      return next();
    };

    if (
      version === VERSION_NEUTRAL ||
      // URL Versioning is done via the path, so the filter continues forward
      versioningOptions.type === VersioningType.URI
    ) {
      const handlerForNoVersioning: VersionedRoute = (req, res, next) =>
        handler(req, res, next);

      return handlerForNoVersioning;
    }

    // Custom Extractor Versioning Handler
    if (versioningOptions.type === VersioningType.CUSTOM) {
      const handlerForCustomVersioning: VersionedRoute = (req, res, next) => {
        const extractedVersion = versioningOptions.extractor(req);

        if (Array.isArray(version)) {
          if (
            Array.isArray(extractedVersion) &&
            version.filter(v => extractedVersion.includes(v as string)).length
          ) {
            return handler(req, res, next);
          }

          if (
            isString(extractedVersion) &&
            version.includes(extractedVersion)
          ) {
            return handler(req, res, next);
          }
        } else if (isString(version)) {
          // Known bug here - if there are multiple versions supported across separate
          // handlers/controllers, we can't select the highest matching handler.
          // Since this code is evaluated per-handler, then we can't see if the highest
          // specified version exists in a different handler.
          if (
            Array.isArray(extractedVersion) &&
            extractedVersion.includes(version)
          ) {
            return handler(req, res, next);
          }

          if (isString(extractedVersion) && version === extractedVersion) {
            return handler(req, res, next);
          }
        }

        return callNextHandler(req, res, next);
      };

      return handlerForCustomVersioning;
    }

    // Media Type (Accept Header) Versioning Handler
    if (versioningOptions.type === VersioningType.MEDIA_TYPE) {
      const handlerForMediaTypeVersioning: VersionedRoute = (
        req,
        res,
        next,
      ) => {
        const MEDIA_TYPE_HEADER = 'Accept';
        const acceptHeaderValue: string | undefined =
          req.headers?.[MEDIA_TYPE_HEADER] ||
          req.headers?.[MEDIA_TYPE_HEADER.toLowerCase()];

        const acceptHeaderVersionParameter = acceptHeaderValue
          ? acceptHeaderValue.split(';')[1]
          : undefined;

        // No version was supplied
        if (isUndefined(acceptHeaderVersionParameter)) {
          if (Array.isArray(version)) {
            if (version.includes(VERSION_NEUTRAL)) {
              return handler(req, res, next);
            }
          }
        } else {
          const headerVersion = acceptHeaderVersionParameter.split(
            versioningOptions.key,
          )[1];

          if (Array.isArray(version)) {
            if (version.includes(headerVersion)) {
              return handler(req, res, next);
            }
          } else if (isString(version)) {
            if (version === headerVersion) {
              return handler(req, res, next);
            }
          }
        }

        return callNextHandler(req, res, next);
      };

      return handlerForMediaTypeVersioning;
    }

    // Header Versioning Handler
    if (versioningOptions.type === VersioningType.HEADER) {
      const handlerForHeaderVersioning: VersionedRoute = (req, res, next) => {
        const customHeaderVersionParameter: string | undefined =
          req.headers?.[versioningOptions.header] ||
          req.headers?.[versioningOptions.header.toLowerCase()];

        // No version was supplied
        if (isUndefined(customHeaderVersionParameter)) {
          if (Array.isArray(version)) {
            if (version.includes(VERSION_NEUTRAL)) {
              return handler(req, res, next);
            }
          }
        } else {
          if (Array.isArray(version)) {
            if (version.includes(customHeaderVersionParameter)) {
              return handler(req, res, next);
            }
          } else if (isString(version)) {
            if (version === customHeaderVersionParameter) {
              return handler(req, res, next);
            }
          }
        }

        return callNextHandler(req, res, next);
      };

      return handlerForHeaderVersioning;
    }
  }

}
