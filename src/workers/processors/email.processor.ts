import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PinoLogger } from 'nestjs-pino';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IAccountBannedPayload,
    IAccountCreatedWithPasswordPayload,
    IAdminLoginOtpPayload,
    IAdminPasswordChangedPayload,
    IForgotPasswordOtpPayload,
    IMonthlyStoreReportPayload,
    IOrderConfirmedPayload,
    IPasswordChangedPayload,
    IPaymentFailedPayload,
    IResetPasswordLinkPayload,
    IScheduledMaintenancePayload,
    ISendEmailBasePayload,
    IVerifyEmailPayload,
    IWalletTopUpSuccessfulPayload,
    IWelcomeToJinxManagementPayload,
} from 'src/common/helper/interfaces/email.interface';
import { IEmailAttachment } from 'src/common/email/interfaces/smtp.service.interface';
import { HelperEmailService } from 'src/common/helper/services/helper.email.service';
import { DashboardReportService } from 'src/modules/dashboard/services/dashboard-report.service';
import { OrderReceiptService } from 'src/modules/order/services/order-receipt.service';

@Processor(APP_BULL_QUEUES.EMAIL)
export class EmailProcessorWorker {
    constructor(
        private readonly helperEmailService: HelperEmailService,
        private readonly orderReceiptService: OrderReceiptService,
        private readonly dashboardReportService: DashboardReportService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(EmailProcessorWorker.name);
    }

    private async dispatch(
        job: Job<ISendEmailBasePayload<Record<string, any>>>,
        emailType: EMAIL_TEMPLATES,
        label: string
    ) {
        const { toEmails, data, subject } = job.data;

        this.logger.info(
            { jobId: job.id, recipients: toEmails.length, emailType },
            `Processing ${label} email job`
        );

        try {
            await this.helperEmailService.sendEmail({
                emails: toEmails,
                emailType,
                payload: data,
                subject,
            });

            this.logger.info(
                { jobId: job.id, recipients: toEmails.length, emailType },
                `${label} emails sent successfully`
            );
        } catch (error) {
            this.logger.error(
                { jobId: job.id, error: error.message, emailType },
                `Failed to send ${label} emails: ${error.message}`
            );
            throw error;
        }
    }

    @Process(EMAIL_TEMPLATES.FORGOT_PASSWORD_OTP)
    async processForgotPasswordOtp(
        job: Job<ISendEmailBasePayload<IForgotPasswordOtpPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.FORGOT_PASSWORD_OTP,
            'forgot-password OTP'
        );
    }

    @Process(EMAIL_TEMPLATES.ADMIN_LOGIN_OTP)
    async processAdminLoginOtp(
        job: Job<ISendEmailBasePayload<IAdminLoginOtpPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.ADMIN_LOGIN_OTP,
            'admin-login OTP'
        );
    }

    @Process(EMAIL_TEMPLATES.VERIFY_EMAIL)
    async processVerifyEmail(
        job: Job<ISendEmailBasePayload<IVerifyEmailPayload>>
    ) {
        await this.dispatch(job, EMAIL_TEMPLATES.VERIFY_EMAIL, 'verify-email');
    }

    @Process(EMAIL_TEMPLATES.RESET_PASSWORD_LINK)
    async processResetPasswordLink(
        job: Job<ISendEmailBasePayload<IResetPasswordLinkPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.RESET_PASSWORD_LINK,
            'reset-password-link'
        );
    }

    @Process(EMAIL_TEMPLATES.WELCOME_TO_JINX_MANAGEMENT)
    async processWelcomeToJinxManagement(
        job: Job<ISendEmailBasePayload<IWelcomeToJinxManagementPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.WELCOME_TO_JINX_MANAGEMENT,
            'welcome-to-jinx-management'
        );
    }

    @Process(EMAIL_TEMPLATES.ACCOUNT_CREATED_WITH_PASSWORD)
    async processAccountCreatedWithPassword(
        job: Job<ISendEmailBasePayload<IAccountCreatedWithPasswordPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.ACCOUNT_CREATED_WITH_PASSWORD,
            'account-created-with-password'
        );
    }

    @Process(EMAIL_TEMPLATES.ACCOUNT_PERMANENTLY_BANNED)
    async processAccountBanned(
        job: Job<ISendEmailBasePayload<IAccountBannedPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.ACCOUNT_PERMANENTLY_BANNED,
            'account-permanently-banned'
        );
    }

    @Process(EMAIL_TEMPLATES.ADMIN_PASSWORD_CHANGED)
    async processAdminPasswordChanged(
        job: Job<ISendEmailBasePayload<IAdminPasswordChangedPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.ADMIN_PASSWORD_CHANGED,
            'admin-password-changed'
        );
    }

    @Process(EMAIL_TEMPLATES.PASSWORD_CHANGED)
    async processPasswordChanged(
        job: Job<ISendEmailBasePayload<IPasswordChangedPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.PASSWORD_CHANGED,
            'password-changed'
        );
    }

    @Process(EMAIL_TEMPLATES.ORDER_CONFIRMED)
    async processOrderConfirmed(
        job: Job<ISendEmailBasePayload<IOrderConfirmedPayload>>
    ) {
        const { toEmails, data } = job.data;
        this.logger.info(
            { jobId: job.id, recipients: toEmails.length },
            'Processing order-confirmed email job'
        );

        try {
            // Best-effort order-summary PDF; never blocks the email on failure.
            const attachment =
                await this.orderReceiptService.generateOrderReceipt(
                    data.orderId,
                    {
                        orderNumber: data.order_id,
                        paymentMethod: data.payment_method,
                        amount: data.amount,
                        date: data.date,
                    }
                );

            await this.helperEmailService.sendEmail({
                emails: toEmails,
                emailType: EMAIL_TEMPLATES.ORDER_CONFIRMED,
                payload: data,
                attachments: attachment ? [attachment] : undefined,
            });

            this.logger.info(
                {
                    jobId: job.id,
                    recipients: toEmails.length,
                    withReceipt: !!attachment,
                },
                'order-confirmed emails sent successfully'
            );
        } catch (error) {
            this.logger.error(
                { jobId: job.id, error: error.message },
                `Failed to send order-confirmed emails: ${error.message}`
            );
            throw error;
        }
    }

    @Process(EMAIL_TEMPLATES.PAYMENT_FAILED)
    async processPaymentFailed(
        job: Job<ISendEmailBasePayload<IPaymentFailedPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.PAYMENT_FAILED,
            'payment-failed'
        );
    }

    @Process(EMAIL_TEMPLATES.WALLET_TOP_UP_SUCCESSFUL)
    async processWalletTopUpSuccessful(
        job: Job<ISendEmailBasePayload<IWalletTopUpSuccessfulPayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.WALLET_TOP_UP_SUCCESSFUL,
            'wallet-top-up-successful'
        );
    }

    @Process(EMAIL_TEMPLATES.SCHEDULED_MAINTENANCE)
    async processScheduledMaintenance(
        job: Job<ISendEmailBasePayload<IScheduledMaintenancePayload>>
    ) {
        await this.dispatch(
            job,
            EMAIL_TEMPLATES.SCHEDULED_MAINTENANCE,
            'scheduled-maintenance'
        );
    }

    @Process(EMAIL_TEMPLATES.MONTHLY_STORE_REPORT)
    async processMonthlyStoreReport(
        job: Job<ISendEmailBasePayload<IMonthlyStoreReportPayload>>
    ) {
        const { toEmails, data } = job.data;
        this.logger.info(
            { jobId: job.id, recipients: toEmails.length },
            'Processing monthly-store-report email job'
        );

        try {
            // Best-effort dashboard report PDF; never blocks the email on failure.
            let attachment: IEmailAttachment | undefined;
            try {
                const buffer =
                    await this.dashboardReportService.generateMonthlyReport(
                        new Date()
                    );
                const month = new Date().toISOString().slice(0, 7); // YYYY-MM
                attachment = {
                    filename: `dashboard-report-${month}.pdf`,
                    content: buffer,
                    contentType: 'application/pdf',
                };
            } catch (pdfError) {
                this.logger.warn(
                    { jobId: job.id, error: pdfError?.message },
                    'Failed to render dashboard report PDF; sending email without it'
                );
            }

            await this.helperEmailService.sendEmail({
                emails: toEmails,
                emailType: EMAIL_TEMPLATES.MONTHLY_STORE_REPORT,
                payload: data,
                attachments: attachment ? [attachment] : undefined,
            });

            this.logger.info(
                {
                    jobId: job.id,
                    recipients: toEmails.length,
                    withPdf: !!attachment,
                },
                'monthly-store-report emails sent successfully'
            );
        } catch (error) {
            this.logger.error(
                { jobId: job.id, error: error.message },
                `Failed to send monthly-store-report emails: ${error.message}`
            );
            throw error;
        }
    }
}
