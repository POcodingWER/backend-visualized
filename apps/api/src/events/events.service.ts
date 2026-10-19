import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './create-event.dto';
import { parseDate } from './date-range';
import { EventBus } from './event-bus';

const toRow = (dto: CreateEventDto): Prisma.EventCreateManyInput => ({
  name: dto.name,
  sessionId: dto.sessionId,
  properties: (dto.properties ?? {}) as Prisma.InputJsonValue,
});

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async create(dto: CreateEventDto) {
    const createdEvent = await this.prisma.event.create({ data: toRow(dto) });
    this.bus.emit(1);
    // BigInt는 JSON 직렬화 불가 → string으로 변환
    return { ...createdEvent, id: createdEvent.id.toString() };
  }

  /** 배치 insert: 단일 INSERT ... VALUES (...), (...) 쿼리 */
  async createBatch(dtos: CreateEventDto[]) {
    const { count } = await this.prisma.event.createMany({ data: dtos.map(toRow) });
    this.bus.emit(count);
    return { inserted: count };
  }

  async stats(fromStr?: string, toStr?: string) {
    const from = parseDate(fromStr, 'from');
    const to = parseDate(toStr, 'to');
    const where: Prisma.EventWhereInput =
      from || to ? { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {};
    const [total, grouped] = await Promise.all([
      this.prisma.event.count({ where }),
      this.prisma.event.groupBy({ by: ['name'], where, _count: { _all: true } }),
    ]);
    const byName = grouped
      .map((group) => ({ name: group.name, count: group._count._all }))
      .sort((left, right) => right.count - left.count);
    return { total, byName };
  }
}
