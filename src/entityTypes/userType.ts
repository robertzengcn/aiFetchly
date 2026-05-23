// User subscription plan type
export type UserPlanType = {
    planName: string,
    planId?: string,
    status: string,
    startDate?: string,
    endDate?: string,
    price?: number,
    currency?: string,
    billingPeriod?: string
}

export type UserInfoType = {
    name: string,
    email: string,
    plans?: Array<UserPlanType>,
    aiEnabled?: boolean  // True if user has a Pro plan with AI features
}