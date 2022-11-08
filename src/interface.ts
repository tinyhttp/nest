import { INestApplication } from '@nestjs/common'
import { App } from '@tinyhttp/app'

export interface NestTinyHttpApplication extends INestApplication {
  getInstance(): App
}
