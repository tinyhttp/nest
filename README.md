<div align="center">

# @tinyhttp/nest

[![npm][npm-img]][npm-url] [![GitHub Workflow Status][gh-actions-img]][github-actions] [![Coverage][cov-img]][cov-url]

</div>

Nest.js adapter for tinyhttp

## Install

```sh
npm i @tinyhttp/@tinyhttp/nest
yarn add @tinyhttp/@tinyhttp/nest
pnpm i @tinyhttp/@tinyhttp/nest

```

## Usage:

```typescript

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {NestTinyHttpApplication} from '@tinyhttp/nest'

async function bootstrap() {
  const app = await NestFactory.create<NestTinyHttpApplication>(AppModule);
  await app.listen(3000);
}
bootstrap();

```

[npm-url]: https://npmjs.com/package/@tinyhttp/nest
[github-actions]: https://github.com/tinyhttp/nest/actions
[gh-actions-img]: https://img.shields.io/github/workflow/status/tinyhttp/nest/CI?style=for-the-badge&logo=github&label=&color=hotpink
[cov-img]: https://img.shields.io/coveralls/github/tinyhttp/nest?style=for-the-badge&color=hotpink
[cov-url]: https://coveralls.io/github/tinyhttp/nest
[npm-img]: https://img.shields.io/npm/dt/@tinyhttp/nest?style=for-the-badge&color=hotpink
