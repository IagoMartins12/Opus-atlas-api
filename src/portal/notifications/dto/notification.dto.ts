import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';

export class NotificationDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: NotificationType }) type: NotificationType;
  @ApiProperty({ enum: NotificationPriority }) priority: NotificationPriority;
  @ApiProperty({ enum: NotificationStatus }) status: NotificationStatus;
  @ApiProperty() title: string;
  @ApiProperty() message: string;
  @ApiPropertyOptional({ nullable: true }) actionText: string | null;
  @ApiPropertyOptional({ nullable: true }) actionUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) relatedEntityType: string | null;
  @ApiPropertyOptional({ nullable: true }) relatedEntityId: string | null;
  @ApiProperty() toastShown: boolean;
  @ApiProperty() browserShown: boolean;
  @ApiPropertyOptional({ nullable: true }) expiresAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ nullable: true }) readAt: Date | null;
}

export class NotificationPaginationDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationDto] }) notifications: NotificationDto[];
  @ApiProperty({ type: NotificationPaginationDto })
  pagination: NotificationPaginationDto;
  @ApiProperty({ example: 3, description: 'Não lidas e ainda vigentes.' })
  unreadCount: number;
}
