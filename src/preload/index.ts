import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('matslop', {
  platform: process.platform
})
