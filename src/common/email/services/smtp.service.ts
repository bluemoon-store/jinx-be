import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as nodemailer from 'nodemailer';

import {
    ISmtpSendParams,
    ISmtpSendResult,
    ISmtpService,
} from '../interfaces/smtp.service.interface';

@Injectable()
export class SmtpService implements ISmtpService {
    private readonly transporter: nodemailer.Transporter;
    private readonly defaultFrom: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(SmtpService.name);

        const host = this.configService.getOrThrow<string>('smtp.host');
        const port = this.configService.getOrThrow<number>('smtp.port');
        const secure = this.configService.getOrThrow<boolean>('smtp.secure');
        const user = this.configService.getOrThrow<string>('smtp.user');
        const password = this.configService.getOrThrow<string>('smtp.password');
        const fromEmail =
            this.configService.getOrThrow<string>('smtp.fromEmail');
        const fromName = this.configService.get<string>('smtp.fromName');

        this.defaultFrom = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user, pass: password },
        });

        // Surface credential/connectivity problems at boot instead of on
        // the first queued email.
        this.transporter
            .verify()
            .then(() =>
                this.logger.info({ host, port }, 'SMTP transport verified')
            )
            .catch((error: Error) =>
                this.logger.error(
                    { message: error.message, host, port },
                    'SMTP transport verification failed'
                )
            );

        this.logger.info('SMTP service initialized');
    }

    async send(params: ISmtpSendParams): Promise<ISmtpSendResult> {
        const from = params.from ?? this.defaultFrom;
        const to = params.to;

        try {
            const info = await this.transporter.sendMail({
                from,
                to,
                subject: params.subject,
                html: params.html,
                ...(params.replyTo !== undefined
                    ? { replyTo: params.replyTo }
                    : {}),
            });

            this.logger.info(
                { messageId: info.messageId, recipients: to.length, to },
                'Email sent via SMTP'
            );

            return { messageId: info.messageId };
        } catch (error) {
            this.logger.error(
                { message: (error as Error).message },
                'SMTP send failed'
            );
            throw error;
        }
    }
}
