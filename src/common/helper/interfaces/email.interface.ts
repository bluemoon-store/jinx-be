import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';

export interface ISendEmailParams {
    emailType: EMAIL_TEMPLATES;
    emails: string[];
    payload: Record<string, any>;
}

export interface ISendEmailBasePayload<T> {
    data: T;
    toEmails: string[];
}

export interface IForgotPasswordOtpPayload {
    otp_code: string;
}

export interface IAdminLoginOtpPayload {
    otp_code: string;
}

export interface IResetPasswordLinkPayload {
    reset_link: string;
    userName: string;
}

export interface IVerifyEmailPayload {
    verification_link: string;
}

export interface IWelcomeToJinxManagementPayload {
    admin_role: string;
    temporary_password: string;
    admin_panel_link: string;
}

export type IAccountBannedPayload = Record<string, never>;

export interface IAdminPasswordChangedPayload {
    admin_email: string;
    updated_date: string;
    admin_panel_link: string;
}

export type IPasswordChangedPayload = Record<string, never>;

export interface IOrderConfirmedPayload {
    order_id: string;
    payment_method: string;
    amount: string;
    date: string;
    dashboard_link: string;
}

export interface IPaymentFailedPayload {
    order_id: string;
    payment_method: string;
    amount: string;
    date: string;
}

export interface IWalletTopUpSuccessfulPayload {
    amount: string;
    wallet_balance: string;
    date: string;
    dashboard_link: string;
}

export interface IScheduledMaintenancePayload {
    date: string;
    start_time: string;
    end_time: string;
}

export interface IMonthlyStoreReportPayload {
    report_month: string;
    total_orders: number;
    total_revenue: string;
}
