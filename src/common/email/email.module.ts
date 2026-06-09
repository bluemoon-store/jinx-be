import { Module } from '@nestjs/common';

import { ResendService } from './services/resend.service';

@Module({
    providers: [ResendService],
    exports: [ResendService],
})
export class EmailModule {}
