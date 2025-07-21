export type SocialTaskEntity = {
    id?: number,
    task_name: string,
    campaign_id: number,
    tag: Array<string>,
    type_id: number,
    type_name?: string,
    keywords: Array<string>,
    extra_task_info?: {
        Id: number,
        TaskId: number,
        ResulttaskId?: number,
    }
    disable?: number
    status?: string
}
export type SocialTaskTypeEntity = {
    id: number,
    name: string,
}

export type SocialTaskResponse = {
    status: boolean,
    msg: string,
    data?: Array<SocialTaskEntity>,
}
export type SocialTaskInfoResponse = {
    status: boolean,
    msg: string,
    data?: SocialTaskEntity,
}
export type SocialTaskTypeResponse = {
    status: boolean,
    msg: string,
    data?: Array<SocialTaskTypeEntity>,
}
export type TagEntity = {
    id: number,
    name: string,
}
export type TagResponse = {
    status: boolean,
    msg: string,
    data?: Array<TagEntity>,
}
export type SaveSocialTaskResponse = {
    status: boolean,
    msg: string,
    data?: { id: number },
}
export type SocialTaskRunEntity = {
    id?: number
    task_id: number
    taskrun_num: string
    log_path: string
    record_time?: string
}
