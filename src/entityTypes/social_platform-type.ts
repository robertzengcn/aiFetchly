export type SocialPlatformEntity={
    id: number,
    name: string
}
export type SocialPlatformResponse = {
    status: string,
    msg: string,
    data: SocialPlatformEntity
}