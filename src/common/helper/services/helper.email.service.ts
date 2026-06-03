import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';
import { PinoLogger } from 'nestjs-pino';

import {
    EMAIL_TEMPLATES,
    EMAIL_TEMPLATE_SUBJECTS,
} from 'src/common/email/enums/email-template.enum';
import { SmtpService } from 'src/common/email/services/smtp.service';

import { ISendEmailParams } from '../interfaces/email.interface';
import {
    IEmailSendResult,
    IHelperEmailService,
} from '../interfaces/email.service.interface';

@Injectable()
export class HelperEmailService implements IHelperEmailService {
    private readonly compiledTemplates = new Map<
        EMAIL_TEMPLATES,
        Handlebars.TemplateDelegate
    >();

    constructor(
        private readonly smtpService: SmtpService,
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(HelperEmailService.name);
    }

    async sendEmail({
        emailType,
        emails,
        payload,
    }: ISendEmailParams): Promise<IEmailSendResult> {
        const subject = this.resolveSubject(emailType);
        const html = this.renderTemplate(
            emailType,
            this.mergeCommonContext(payload ?? {})
        );

        return this.smtpService.send({
            to: emails,
            subject,
            html,
        });
    }

    private mergeCommonContext(
        payload: Record<string, any>
    ): Record<string, any> {
        const links =
            this.configService.get<Record<string, string>>('app.emailLinks') ??
            {};
        const commonContext = {
            asset_url:
                this.configService.get<string>('app.emailAssetBaseUrl') ?? '',
            store_link: links.store ?? '',
            telegram_link: links.telegram ?? '',
            discord_link: links.discord ?? '',
            support_link: links.support ?? '',
            terms_link: links.terms ?? '',
            privacy_link: links.privacy ?? '',
            cookies_link: links.cookies ?? '',
            refunds_link: links.refunds ?? '',
            admin_panel_link: links.adminPanel ?? '',
        };

        // Caller payload wins on collision (per-recipient values like
        // admin_panel_link for specific roles override the global default).
        return { ...commonContext, ...payload };
    }

    private resolveSubject(emailType: EMAIL_TEMPLATES): string {
        const subjects: Record<EMAIL_TEMPLATES, string> = {
            [EMAIL_TEMPLATES.FORGOT_PASSWORD_OTP]:
                EMAIL_TEMPLATE_SUBJECTS.FORGOT_PASSWORD_OTP,
            [EMAIL_TEMPLATES.VERIFY_EMAIL]:
                EMAIL_TEMPLATE_SUBJECTS.VERIFY_EMAIL,
            [EMAIL_TEMPLATES.RESET_PASSWORD_LINK]:
                EMAIL_TEMPLATE_SUBJECTS.RESET_PASSWORD_LINK,
            [EMAIL_TEMPLATES.WELCOME_TO_JINX_MANAGEMENT]:
                EMAIL_TEMPLATE_SUBJECTS.WELCOME_TO_JINX_MANAGEMENT,
            [EMAIL_TEMPLATES.ACCOUNT_PERMANENTLY_BANNED]:
                EMAIL_TEMPLATE_SUBJECTS.ACCOUNT_PERMANENTLY_BANNED,
            [EMAIL_TEMPLATES.ADMIN_PASSWORD_CHANGED]:
                EMAIL_TEMPLATE_SUBJECTS.ADMIN_PASSWORD_CHANGED,
            [EMAIL_TEMPLATES.PASSWORD_CHANGED]:
                EMAIL_TEMPLATE_SUBJECTS.PASSWORD_CHANGED,
            [EMAIL_TEMPLATES.ORDER_CONFIRMED]:
                EMAIL_TEMPLATE_SUBJECTS.ORDER_CONFIRMED,
            [EMAIL_TEMPLATES.PAYMENT_FAILED]:
                EMAIL_TEMPLATE_SUBJECTS.PAYMENT_FAILED,
            [EMAIL_TEMPLATES.WALLET_TOP_UP_SUCCESSFUL]:
                EMAIL_TEMPLATE_SUBJECTS.WALLET_TOP_UP_SUCCESSFUL,
            [EMAIL_TEMPLATES.SCHEDULED_MAINTENANCE]:
                EMAIL_TEMPLATE_SUBJECTS.SCHEDULED_MAINTENANCE,
            [EMAIL_TEMPLATES.MONTHLY_STORE_REPORT]:
                EMAIL_TEMPLATE_SUBJECTS.MONTHLY_STORE_REPORT,
        };
        const subject = subjects[emailType];
        if (!subject) {
            throw new Error(`Unknown email template: ${emailType}`);
        }
        return subject;
    }

    private renderTemplate(
        emailType: EMAIL_TEMPLATES,
        payload: Record<string, any>
    ): string {
        let compiled = this.compiledTemplates.get(emailType);

        if (!compiled) {
            const templatePath = path.join(
                __dirname,
                '../../email/templates',
                `${emailType}.hbs`
            );
            const source = fs.readFileSync(templatePath, 'utf8');
            compiled = Handlebars.compile(source);
            this.compiledTemplates.set(emailType, compiled);
        }

        return compiled(payload);
    }
}
