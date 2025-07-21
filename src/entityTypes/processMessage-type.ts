export type ProcessMessage<type> = {
    action: string,
    data?:type
}