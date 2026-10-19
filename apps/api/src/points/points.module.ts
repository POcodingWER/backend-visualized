import { Module } from '@nestjs/common';
import { PointsController } from './points.controller';

@Module({ controllers: [PointsController] })
export class PointsModule {}
