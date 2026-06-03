import { Module } from '@nestjs/common';

import { SmtpService } from './services/smtp.service';

@Module({
    providers: [SmtpService],
    exports: [SmtpService],
})
export class EmailModule {}
