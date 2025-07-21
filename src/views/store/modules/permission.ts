import { VuexModule, Module, Mutation, Action, getModule } from 'vuex-module-decorators'
import { RouteRecordRaw } from 'vue-router'
import { asyncRoutes, constantRoutes } from '@/views/router'
import store from '@/views/store'

const hasPermission = (roles: string[], route: RouteRecordRaw) => {
  if (route.meta && Array.isArray(route.meta.roles)) {
    const routeRoles = route.meta.roles as string[]; // Cast route.meta.roles to string[]
    return roles.some(role => routeRoles.includes(role)); // Use routeRoles instead of route.meta.roles
  } else {
    return true;
  }
}

export const filterAsyncRoutes = (routes: RouteRecordRaw[], roles: string[]) => {
  const res: RouteRecordRaw[] = []
  routes.forEach(route => {
    const r = { ...route }
    if (hasPermission(roles, r)) {
      if (r.children) {
        r.children = filterAsyncRoutes(r.children, roles)
      }
      res.push(r)
    }
  })
  return res
}

export interface IPermissionState {
  routes: RouteRecordRaw[]
  dynamicRoutes: RouteRecordRaw[]
}

@Module({ dynamic: true, store, name: 'permission' })
class Permission extends VuexModule implements IPermissionState {
  public routes: RouteRecordRaw[] = []
  public dynamicRoutes: RouteRecordRaw[] = []

  @Mutation
  private SET_ROUTES(routes: RouteRecordRaw[]) {
    this.routes = constantRoutes.concat(routes)
    this.dynamicRoutes = routes
  }

  @Action
  public GenerateRoutes(roles: string[]) {
    let accessedRoutes
    if (roles.includes('admin')) {
      accessedRoutes = asyncRoutes
    } else {
      accessedRoutes = filterAsyncRoutes(asyncRoutes, roles)
    }
    this.SET_ROUTES(accessedRoutes)
  }
}

export const PermissionModule = getModule(Permission)
