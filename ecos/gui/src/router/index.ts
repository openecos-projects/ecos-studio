import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

// 使用 Hash 模式，因为 Tauri 应用使用本地文件系统
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Welcome',
    component: () => import('../views/WelcomeView.vue'),
    meta: {
      title: 'ECC '
    }
  },
  {
    path: '/workspace',
    name: 'Workspace',
    component: () => import('../views/WorkspaceView.vue'),
    redirect: '/workspace/home',
    children: [
      // 固定的设置页面
      { path: 'home', name: 'Home', component: () => import('../views/HomeView.vue') },
      { path: 'configure', name: 'Configure', component: () => import('../views/ConfigureView.vue') },
      // 动态步骤路由：匹配所有 flow 步骤
      // 路由验证放宽，允许任何步骤路径（由 flow.json 动态决定）
      {
        path: ':step',
        name: ':step',
        component: () => import('../views/EditorView.vue')
      }
    ],
    meta: {
      title: 'Workspace',
      requiresProject: true
    }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 路由守卫：确保有项目才能进入工作区
router.beforeEach((to, _from, next) => {
  if (to.meta.requiresProject) {
    // 这里可以检查是否有打开的项目
    // 暂时先允许通过，后续可以添加验证逻辑
    next()
  } else {
    next()
  }
})

export default router
