import { VuexModule, Module, Action, Mutation, getModule } from 'vuex-module-decorators'
import { login,Signout,getUserInfo } from '@/views/api/users'
import { getToken, setToken, removeToken } from '@/views/utils/cookies'
import router from '@/views/router'
import { PermissionModule } from './permission'
// import { TagsViewModule } from './tags-view'
import store from '@/views/store'

export interface IUserState {
  token: string
  name: string
  avatar: string
  introduction: string
  roles: string[]
  email: string
}

@Module({ dynamic: true, store, name: 'user' })
class User extends VuexModule implements IUserState {
  public token = getToken() || ''
  public name = ''
  public avatar = ''
  public introduction = ''
  public roles: string[] = []
  public email = ''

  @Mutation
  private SET_TOKEN(token: string) {
    this.token = token
  }

  @Mutation
  private SET_NAME(name: string) {
    this.name = name
  }

  @Mutation
  private SET_AVATAR(avatar: string) {
    this.avatar = avatar
  }

  @Mutation
  private SET_INTRODUCTION(introduction: string) {
    this.introduction = introduction
  }

  @Mutation
  private SET_ROLES(roles: string[]) {
    this.roles = roles
  }

  @Mutation
  private SET_EMAIL(email: string) {
    this.email = email
  }

  @Action({rawError: true})
  public async Login(userInfo: { username: string, password: string}) {
    let  username = userInfo.username
    const password = userInfo.password
    username = username.trim()
    const data=await login({ username, password })
    // console.log(data)
    if(data.status==false){
      throw Error(data.msg)
    }else{
      // action after user login
      // setToken(data.data.token)
      // this.SET_TOKEN(data.data.token)
      this.SET_ROLES(data.data.roles)

      const roles = UserModule.roles
          // Generate accessible routes map based on role
      PermissionModule.GenerateRoutes(roles)
          // Dynamically add accessible routes
      PermissionModule.dynamicRoutes.forEach(route => {
            router.addRoute(route)
     })
    }
    // console.log(data)
    // setToken(data.accessToken)
    // this.SET_TOKEN(data.accessToken)
  }
  @Action({rawError: true})
  public loginCallback(data: any) {
    if(data.status==false){
      throw Error(data.msg)
    }else{
      setToken(data.token)
      this.SET_TOKEN(data.token)
    }
  }

  @Action({rawError: true})
  public ResetToken() {
    removeToken()
    this.SET_TOKEN('')
    this.SET_ROLES([])
  }

  @Action({rawError: true})
  public async GetUserInfo() {
  
    const data  = await getUserInfo()
    // console.log(data);
    if (!data) {
      throw Error('Verification failed, please Login again.')
    }
    if(data.status==false){
      throw Error(data.msg)
    }
    const { roles, name, email } = data.data
    // roles must be a non-empty array
    if (!roles || roles.length <= 0) {
      throw Error('GetUserInfo: roles must be a non-null array!')
    }
    this.SET_ROLES(roles)
    this.SET_NAME(name)
    // this.SET_AVATAR(avatar)
    // this.SET_INTRODUCTION(introduction)
    this.SET_EMAIL(email)
    return data.data
  }

  @Action
  public async ChangeRoles(role: string) {
    // Dynamically modify permissions
    const token = role + '-token'
    this.SET_TOKEN(token)
    setToken(token)
    await this.GetUserInfo()
    // resetRouter()
    // Generate dynamic accessible routes based on roles
    PermissionModule.GenerateRoutes(this.roles)
    // Add generated routes
    PermissionModule.dynamicRoutes.forEach(route => {
      router.addRoute(route)
    })
    // Reset visited views and cached views
    // TagsViewModule.delAllViews()
  }

  @Action
  public async LogOut() {
    if (this.token === '') {
      throw Error('LogOut: token is undefined!')
    }
    await Signout()
    removeToken()
    // resetRouter()

    // Reset visited views and cached views
    // TagsViewModule.delAllViews()
    this.SET_TOKEN('')
    this.SET_ROLES([])
  }
}

export const UserModule = getModule(User)
