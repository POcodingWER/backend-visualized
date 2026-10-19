import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './create-event.dto';

function parseDate(v: string | undefined, field: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`invalid ${field}`);
  return d;
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventDto) {
    const e = await this.prisma.event.create({
      data: {
        name: dto.name,
        sessionId: dto.sessionId,
        properties: (dto.properties ?? {}) as Prisma.InputJsonValue,
      },
    });
    // BigInt는 JSON 직렬화 불가 → string으로 변환
    return { ...e, id: e.id.toString() };
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
      .map((g) => ({ name: g.name, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
    return { total, byName };
  }
}
