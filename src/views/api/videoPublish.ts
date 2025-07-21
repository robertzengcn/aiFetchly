//import { ipcRenderer } from 'electron';
import { SearchResult } from './types';
import { VideoPublishRecordEntity } from '@/entity/VideoPublishRecord.entity';
import { CommonDialogMsg } from '@/entityTypes/commonType';
import { windowReceive, windowInvoke } from '@/views/utils/apirequest'
import { VIDEO_PUBLISH_RECORD_LIST, VIDEO_PUBLISH_RECORD_DELETE, VIDEO_PUBLISH_RECORD_MESSAGE } from '@/config/channellist'

export interface PublishRecordQuery {
  page: number;
  size: number;
  search?: string;
}

export async function getPublishRecords(param: PublishRecordQuery): Promise<SearchResult<VideoPublishRecordEntity>> {
  const res=await windowInvoke(VIDEO_PUBLISH_RECORD_LIST, param);
  if(res){
    return {
      data: res.records,
      total: res.total
    }
  }else{
    return {
      data: [],
      total: 0
    }
  }
}

export async function deletePublishRecord(id: number): Promise<boolean> {
  return await windowInvoke(VIDEO_PUBLISH_RECORD_DELETE, {id});
}

export function receivePublishRecordMessage(cb: (data: CommonDialogMsg) => void) {
  windowReceive(VIDEO_PUBLISH_RECORD_MESSAGE, cb)
} 