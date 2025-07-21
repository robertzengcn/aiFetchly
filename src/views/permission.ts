import router from '@/views/router'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
// import { Message } from 'element-ui'
//import { Router } from 'vue-router'
import { UserModule } from '@/views/store/modules/user'
import { PermissionModule } from '@/views/store/modules/permission'
// import i18n from '@/lang' // Internationalization
import settings from '@/views/settings'

// NProgress.configure({ showSpinner: false })

const whiteList = ['/login', '/auth-redirect']

const getPageTitle = (key: string) => {

  // const hasKey = i18n.te(`route.${key}`)
  //   if (hasKey) {
  //     const pageName = i18n.t(`route.${key}`)
  //     return `${pageName} - ${settings.title}`
  //   }
  return `${settings.title}`
}

router.beforeEach(async (to, from, next: any) => {
  // Start progress bar
  NProgress.start()
  let userinfo
  try{
  userinfo=await  UserModule.GetUserInfo()
  // console.log(userinfo)
  }catch(err){
    console.log(err)
  }
  // Determine whether the user has logged in
  if (userinfo) {
    if (to.path === '/login') {
      // If is logged in, redirect to the home page
      next({ path: '/' })
      NProgress.done()
    } else {
      // console.log(UserModule.roles)
      // Check whether the user has obtained his permission roles
      try {
        if (UserModule.roles.length === 0) {
          UserModule.ResetToken()
          console.log('user role empty, login failure')
          next(`/login?redirect=${to.path}`)
        } else {
          
          next()
        }
      } catch (err) {
        console.error(err)
        // Remove token and redirect to login page
        UserModule.ResetToken()
        // Message.error('Has Error')
        next(`/login?redirect=${to.path}`)
        NProgress.done()
      }
      // } else {
      //   next()
      // }
    }
  } else {
    console.log("to path is"+to.path)
    // Has no token
    if (whiteList.indexOf(to.path) !== -1) {
      // In the free login whitelist, go directly
      next()
    } else {
      const topath=`/login?redirect=${to.path}`
     //const topath=`/login`

      console.log('no token')
      console.log(topath)
      // Other pages that do not have permission to access are redirected to the login page.
      next(topath)
      NProgress.done()
    }
  }
})

router.afterEach(() => {
  // Finish progress bar
  // hack: https://github.com/PanJiaChen/vue-element-admin/pull/2939
  NProgress.done()
  // set page title
  // document.title = getPageTitle(to.meta.title)
})
