import { Module } from '@nestjs/common';
import { UploadsModule } from '../../uploads/uploads.module';
import { CommentsAdminController } from './comments-admin.controller';
import { CommentsAdminService } from './comments-admin.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  // `UploadsModule` fornece o `ModerationService`: a denúncia de comentário
  // entra na fila de moderação da plataforma (RN-4).
  imports: [UploadsModule],
  controllers: [CommentsController, CommentsAdminController],
  providers: [CommentsService, CommentsAdminService],
})
export class CommentsModule {}
