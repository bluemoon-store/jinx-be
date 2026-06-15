import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import { IEmailAttachment } from 'src/common/email/interfaces/smtp.service.interface';

export interface ISendEmailParams {
    emailType: EMAIL_TEMPLATES;
    emails: string[];
    payload: Record<string, any>;
    attachments?: IEmailAttachment[];
    // Optional per-send subject override; falls back to the template default.
    subject?: string;
}

export interface ISendEmailBasePayload<T> {
    data: T;
    toEmails: string[];
    // Optional per-send subject override; falls back to the template default.
    subject?: string;
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

export interface IAccountCreatedWithPasswordPayload {
    user_email: string;
    generated_password: string;
    login_link: string;
}

export type IAccountBannedPayload = Record<string, never>;

export interface IAdminPasswordChangedPayload {
    admin_email: string;
    updated_date: string;
    admin_panel_link: string;
}

export type IPasswordChangedPayload = Record<string, never>;

export interface IOrderConfirmedLineItem {
    name: string;
    variant?: string | null;
    quantity: number;
    unit_price: string;
    line_total: string;
}

export interface IOrderConfirmedPayload {
    order_id: string;
    payment_method: string;
    amount: string;
    date: string;
    dashboard_link: string;
    /** Internal DB order id (UUID) — used by the worker to render the order-summary image. */
    orderId?: string;
    /** Purchased line items shown in the email body. */
    line_items?: IOrderConfirmedLineItem[];
    subtotal?: string;
    /** Only set when a discount was applied (> 0). */
    discount?: string;
    total?: string;
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
    title: string;
    intro: string;
    impact_note: string;
    apology_note: string;
}

export interface IMonthlyStoreReportPayload {
    report_month: string;
    total_orders: number;
    total_revenue: string;
    avg_order_value: string;
    new_customers: number;
    fulfillment_rate: string;
    top_category: string;
    top_category_revenue: string;
    top_payment_method: string;
}
