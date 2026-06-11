export interface IEmailAttachment {
    filename: string;
    content: Buffer;
    contentType?: string;
}

export interface ISmtpSendParams {
    to: string[];
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
    attachments?: IEmailAttachment[];
}

export interface ISmtpSendResult {
    messageId: string;
}

export interface ISmtpService {
    send(params: ISmtpSendParams): Promise<ISmtpSendResult>;
}
