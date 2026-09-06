"use strict";

import {
  windowSend,
  windowReceive,
  windowInvoke,
} from "@/views/utils/apirequest";
import { EmailMarketingsubdata } from "@/entityTypes/emailmarketingType";
import {
  BUCKEMAILSEND,
  BUCKEMAILTASKLIST,
  BUCKEMAILTASKSENDLOG,
  UNIFIED_EMAIL_SEND_LOG,
} from "@/config/channellist";
import { SearchResult } from "@/views/api/types";
import { ItemSearchparam } from "@/entityTypes/commonType";
import {
  BuckEmailListType,
  BuckEmailTasklogQueryType,
  EmailMarketingSendLogListDisplay,
  UnifiedSendLogEntry,
} from "@/entityTypes/buckemailType";

export async function buckEmailsend(data: EmailMarketingsubdata) {
  windowSend(BUCKEMAILSEND, data);

  // return resp
}
export function receiveBuckEmailevent(
  channel: string,
  cb: (data: string) => void
) {
  windowReceive<string>(channel, cb);
}

//get email service list
export async function getBuckEmailSendtaskList(
  params: ItemSearchparam
): Promise<SearchResult<BuckEmailListType>> {
  const resp = await windowInvoke(BUCKEMAILTASKLIST, params);

  if (!resp) {
    throw new Error("unknow error");
  }

  const resdata: SearchResult<BuckEmailListType> = {
    data: resp.records,
    total: resp.num,
  };
  return resdata;
}
//get buck email send log
export async function getBuckEmailSendLog(
  params: BuckEmailTasklogQueryType
): Promise<SearchResult<EmailMarketingSendLogListDisplay>> {
  const resp = await windowInvoke(BUCKEMAILTASKSENDLOG, params);

  if (!resp) {
    throw new Error("unknow error");
  }

  const resdata: SearchResult<EmailMarketingSendLogListDisplay> = {
    data: resp.records,
    total: resp.num,
  };
  return resdata;
}
//get unified email send log (legacy bulk-task + authorized outbound)
export async function getUnifiedEmailSendLog(
  params: ItemSearchparam
): Promise<SearchResult<UnifiedSendLogEntry>> {
  const resp = await windowInvoke(UNIFIED_EMAIL_SEND_LOG, params);

  if (!resp) {
    throw new Error("unknow error");
  }

  const resdata: SearchResult<UnifiedSendLogEntry> = {
    data: resp.records,
    total: resp.num,
  };
  return resdata;
}
