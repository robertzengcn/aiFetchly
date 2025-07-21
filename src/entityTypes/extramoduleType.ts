export type ExtraModuleItem={
    name:string,
    packagename:string,
    packagenameTr?:string,//translate
    version:string,
    installed:boolean
    loading?:boolean
    description:string
    installVersion?:string
    upgradeLoading?:boolean
    upgradeAvailable?:boolean
}
export type ExtraModule={
    name:string,
    // description:string,
    packagename:string,
    version:string,
    installed?:boolean,
    link:string,
    requirePy:boolean,
    ispip:boolean,
    requireFfmpeg:boolean
    installVersion?:string
    upgradeAvailable?:boolean
}
export type ExtraModuleEntity={
    id:number,
    name:string,
    version:string,
}