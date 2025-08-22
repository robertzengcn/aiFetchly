export type SocialPlatformEntity={
    id: number,
    name: string,
    url: string,
    category: string
}
export type SocialPlatformResponse = {
    status: string,
    msg: string,
    data: SocialPlatformEntity
}