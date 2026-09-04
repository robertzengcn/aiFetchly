import {
  windowInvoke,
  windowSend,
  windowReceive,
} from "@/views/utils/apirequest";
import {
  EMAILSERVICEUPDATE,
  EMAILSERVICEDETAIL,
  EMAILSERVICELIST,
  EMAILSERVICEDELETE,
  EMAILSERVICEEXPORT,
  EMAILSERVICEIMPORT,
  SENDTESTEMAIL,
  RECEIVESENDTESTEMAILMESSAGE,
} from "@/config/channellist";
import { SearchResult } from "@/views/api/types";
import { ItemSearchparam, CommonIdrequest } from "@/entityTypes/commonType";
import {
  EmailServiceEntitydata,
  EmailServiceListdata,
  EmailSendParam,
} from "@/entityTypes/emailmarketingType";
//get email service list
export async function getEmailServiceList(
  params: ItemSearchparam
): Promise<SearchResult<EmailServiceListdata>> {
  const resp = await windowInvoke(EMAILSERVICELIST, params);
  console.log(resp);
  if (!resp) {
    throw new Error("unknow error");
  }

  const resdata: SearchResult<EmailServiceListdata> = {
    data: resp.records,
    total: resp.num,
  };
  return resdata;
}
//get email service detail
export async function getEmailServiceDetail(
  id: number
): Promise<EmailServiceEntitydata> {
  const params: CommonIdrequest<number> = { id: id };
  return await windowInvoke(EMAILSERVICEDETAIL, params);
}

export async function createupdateEmailService(
  data: EmailServiceEntitydata
): Promise<CommonIdrequest<number>> {
  return await windowInvoke(EMAILSERVICEUPDATE, data);
}

export async function deleteEmailService(
  id: number
): Promise<CommonIdrequest<number>> {
  const params: CommonIdrequest<number> = { id: id };
  return await windowInvoke(EMAILSERVICEDELETE, params);
}
// export email service list to a file chosen via the native save dialog
export async function exportEmailServices(
  format: "csv" | "json" = "csv"
): Promise<string> {
  const resp = await windowInvoke(EMAILSERVICEEXPORT, { format });
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp as string;
}
/** Result envelope for email service import (counts + per-row errors). */
export interface EmailServiceImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// Import email services from a file chosen via the native open dialog (the
// file path is picked in the main process; the renderer sends no data).
// Resolves with the import summary; rejects (Error) on cancel/failure so the
// component's try/catch can pick the snackbar type from error.message.
export async function importEmailServices(): Promise<EmailServiceImportResult> {
  const resp = await windowInvoke(EMAILSERVICEIMPORT, {});
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp as EmailServiceImportResult;
}
//send test email
export async function sendTestemail(params: EmailSendParam) {
  windowSend(SENDTESTEMAIL, params);
}

export function receiveEmailsendevent(cb: (data: string) => void) {
  windowReceive(RECEIVESENDTESTEMAILMESSAGE, cb);
}
