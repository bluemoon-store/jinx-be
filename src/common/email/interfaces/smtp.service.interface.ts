export interface ISmtpSendParams {
    to: string[];
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
}

export interface ISmtpSendResult {
    messageId: string;
}

export interface ISmtpService {
    send(params: ISmtpSendParams): Promise<ISmtpSendResult>;
}
