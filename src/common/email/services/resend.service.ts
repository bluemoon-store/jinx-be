import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Resend } from 'resend';

import {
    ISmtpSendParams,
    ISmtpSendResult,
    ISmtpService,
} from '../interfaces/smtp.service.interface';

@Injectable()
export class ResendService implements ISmtpService {
    private readonly client: Resend;
    private readonly defaultFrom: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(ResendService.name);

        const apiKey = this.configService.getOrThrow<string>('resend.apiKey');
        const fromEmail =
            this.configService.getOrThrow<string>('resend.fromEmail');
        const fromName = this.configService.get<string>('resend.fromName');

        this.defaultFrom = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

        this.client = new Resend(apiKey);

        this.logger.info('Resend service initialized');
    }

    async send(params: ISmtpSendParams): Promise<ISmtpSendResult> {
        const from = params.from ?? this.defaultFrom;
        const to = params.to;

        const { data, error } = await this.client.emails.send({
            from,
            to,
            subject: params.subject,
            html: params.html,
            ...(params.replyTo !== undefined
                ? { replyTo: params.replyTo }
                : {}),
            ...(params.attachments?.length
                ? {
                      attachments: params.attachments.map(a => ({
                          filename: a.filename,
                          content: a.content,
                          ...(a.contentType
                              ? { contentType: a.contentType }
                              : {}),
                      })),
                  }
                : {}),
        });

        if (error) {
            this.logger.error({ message: error.message }, 'Resend send failed');
            throw new Error(error.message);
        }

        this.logger.info(
            { messageId: data!.id, recipients: to.length, to },
            'Email sent via Resend'
        );

        return { messageId: data!.id };
    }
}
