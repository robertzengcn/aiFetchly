export type campaignRes = {
    data: Array<campaignEntity>,
    num: number,
}
export type campaignEntity = {
    CampaignId: number,
    CampaignName: string,
    CampaignDescription: string,
    Disable: number,
    Tags: string,
    Status?: string,
}

export type campaignResponse = {
    status: boolean,
    msg: string,
    data?: campaignEntity,
}