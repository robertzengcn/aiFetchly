export type KeywordResponse = {
    status: boolean,
    msg: string,
    data?: Array<string>,
}
export type KeywordEntity = {
    id: number,
    keyword: string,
    task_id: number,
}