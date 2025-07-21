import nodemailer from 'nodemailer';
import {EmailServiceEntitydata,EmailRequestData} from "@/entityTypes/emailmarketingType";
export class EmailService {
    private transporter: nodemailer.Transporter;
    private emailSender: string;
    constructor(param: EmailServiceEntitydata) {
        this.emailSender = param.from;
        this.transporter = nodemailer.createTransport({
            host: param.host,
            port: Number(param.port) || 0,
            secure: param.ssl, // true for 465, false for other ports
            auth: {
                user: param.from, // your SMTP username
                pass: param.password, // your SMTP password
            }
        } as nodemailer.TransportOptions);
        // this.transporter = transporter;
    }

    // public getService(param: EmailServiceEntitydata) {
    //     const transporter = nodemailer.createTransport({
    //         host: param.host,
    //         port: Number(param.port) || 0,
    //         secure: param.ssl, // true for 465, false for other ports
    //         auth: {
    //             user: param.from, // your SMTP username
    //             pass: param.password, // your SMTP password
    //         }
    //     } as nodemailer.TransportOptions);
    //     return transporter
    // }
    public async sendEmail(param: EmailRequestData,errorCallback?:(errorMessage: string)=>void,successCallback?:()=>void ): Promise<any> {

          // Configure the mailoptions object
          const mailOptions = {
            from: this.emailSender,
            to: param.Receiver,
            subject: param.Title,
            text: param.Content
        };


            // Send the email
            this.transporter.sendMail(mailOptions, function (error, info) {
                if (error) {
                    console.error('Error:', error);
                    if (errorCallback) {
                        errorCallback(error.message)
                        // errorCallback(item.address, error.message, emailTpldata.TplTitle, emailTpldata.TplContent)
                    }
                } else {
                    console.log('Email sent:', info.response);
                    if (successCallback) {
                        successCallback()
                        // successCallback(item.address, emailTpldata.TplTitle, emailTpldata.TplContent)
                    }
                }
            });


    }

}