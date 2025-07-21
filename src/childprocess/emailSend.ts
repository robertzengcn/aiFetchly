import { Buckemailremotedata } from "@/entityTypes/emailmarketingType";
import nodemailer from 'nodemailer';
import { convertVariableInTemplate } from "@/views/utils/emailFun"
import { EmailTemplatePreviewdata } from "@/entityTypes/emailmarketingType"
import {EmailService} from "@/modules/lib/emailService"
import {EmailServiceEntitydata,EmailRequestData} from "@/entityTypes/emailmarketingType";

export class EmailSend {

    public async send(param: Buckemailremotedata, successCallback?: (receiver: string, title: string, content: string) => void | undefined | null, errorCallback?: (receiver: string, info: string, title: string, content: string) => void | undefined | null): Promise<any> {
        const totalfilter: string[] = []
        if (param.Emailfilterlist&&param.Emailfilterlist.length>0) {
            param.Emailfilterlist.forEach((item) => {
                if(item.filter_details&&item.filter_details.length>0){
                item.filter_details.forEach((filterdetail) => {
                        totalfilter.push(filterdetail.content)
                    })
                }
            })
        }

        //loop receiver
        param.Receiverlist.forEach((item) => {

            //check if item in filter list
            if (totalfilter.includes(item.address)) {
                return
            }

            // param.Emailfilterlist.forEach((filterlist) => {
            //     filterlist.filter_details.forEach((filterdetail) => {
            //         const regex = new RegExp(filterdetail.content);
            //         if (regex.test(item.address)) {
            //             return;
            //         }
            //     })
            // })
            for (const filterlist of param.Emailfilterlist) {

                for (const filterdetail of filterlist.filter_details) {
                    try {
                        const regex = new RegExp(filterdetail.content);
                        if (regex.test(item.address)) {
                            return;
                        }
                    } catch (error) {
                        if (filterdetail.content.includes('*')) {
                            try {
                                const regex = new RegExp(filterdetail.content.replace(/\*/g, '.*'));

                                if (regex.test(item.address)) {
                                    return;
                                }
                            } catch (rerr) {
                                console.log(`Invalid regular expression second: ${filterdetail.content}`, rerr)
                            }
                        }else{
                             console.log(`Invalid regular expression: ${filterdetail.content}`, error);
                        }
                       
                    }
                }
            }


            //get random one from email send list
            const randomEmailservice = this.getRandomItem(param.Emailservicelist);

            //get random email template
            const randEmailtpl = this.getRandomItem(param.Emailtemplist);
            const previewData: EmailTemplatePreviewdata = {
                TplTitle: randEmailtpl.TplTitle,
                TplContent: randEmailtpl.TplContent,
                Sender: randomEmailservice.from,
                Receiver: item.address
            }
            //replace variable in email template
            const emailTpldata = convertVariableInTemplate(previewData);
            //send email
            // Create a transporter object
            // const transporter = nodemailer.createTransport({
            //     host: randomEmailservice.host,
            //     port: Number(randomEmailservice.port) || 0,
            //     secure: randomEmailservice.ssl, // true for 465, false for other ports
            //     auth: {
            //         user: randomEmailservice.from, // your SMTP username
            //         pass: randomEmailservice.password, // your SMTP password
            //     }
            // } as nodemailer.TransportOptions);
            // // Configure the mailoptions object
            // const mailOptions = {
            //     from: randomEmailservice.from,
            //     to: item.address,
            //     subject: emailTpldata.TplTitle,
            //     text: emailTpldata.TplContent
            // };
            const emailserviceenditydata:EmailServiceEntitydata={
                name:randomEmailservice.name,
                from:randomEmailservice.from,
                host:randomEmailservice.host,
                port:randomEmailservice.port,
                ssl:randomEmailservice.ssl,
                password:randomEmailservice.password
            }
            const emailServie=new EmailService(emailserviceenditydata)
            const emailRequestdata:EmailRequestData={
                From:randomEmailservice.from,
                Receiver:item.address,
                Title:emailTpldata.TplTitle,
                Content:emailTpldata.TplContent
            }
            emailServie.sendEmail(emailRequestdata,function (error){
                             if (errorCallback) {
                        errorCallback(item.address, error, emailTpldata.TplTitle, emailTpldata.TplContent)
                    }
            },function(){
                                    if (successCallback) {
                        successCallback(item.address, emailTpldata.TplTitle, emailTpldata.TplContent)
                    }
            })
            // // Send the email
            // transporter.sendMail(mailOptions, function (error, info) {
            //     if (error) {
            //         console.error('Error:', error);
            //         if (errorCallback) {
            //             errorCallback(item.address, error.message, emailTpldata.TplTitle, emailTpldata.TplContent)
            //         }
            //     } else {
            //         console.log('Email sent:', info.response);
            //         if (successCallback) {
            //             successCallback(item.address, emailTpldata.TplTitle, emailTpldata.TplContent)
            //         }
            //     }
            // });

        })
    }
    // Function to get a random item from an array
    private getRandomItem<Type>(array: Array<Type>): Type {
        const randomIndex = Math.floor(Math.random() * array.length);
        return array[randomIndex];
    }

}