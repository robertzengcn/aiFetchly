import {EmailTemplatePreviewdata,EmailTemplatedata} from "@/entityTypes/emailmarketingType"

export function convertVariableInTemplate(data:EmailTemplatePreviewdata): EmailTemplatedata {
    //replace variable in template
    let content = data.TplContent;
    const url=data.Url?data.Url:""
    const description=data.Description?data.Description:""
    content = content.replace(/{\$sender}/g, data.Sender);
    content = content.replace(/{\$receiver_email}/g, data.Receiver);
    //replace time variable
    const date = new Date();
    //const time = date.toLocaleTimeString();
    const formattedDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
    content = content.replace(/{\$send_time}/g, formattedDate);
    
    //replace the email url
    content = content.replace(/{\$url}/g, url);
    //description
    content = content.replace(/{\$description}/g, description);

    let title=data.TplTitle
    title = title.replace(/{\$sender}/g, data.Sender);
    title = title.replace(/{\$receiver_email}/g, data.Receiver);
    title=title.replace(/{\$send_time}/g, formattedDate);

     //replace the email url
     title = title.replace(/{\$url}/g, url);
     //description
     title = title.replace(/{\$description}/g, description);
  
    const resdata: EmailTemplatedata = {
      TplTitle: title,
      TplContent: content
    }
    return resdata;
  
  } 