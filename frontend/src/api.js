import axios from 'axios'
export const api = axios.create({ baseURL:'/api', withCredentials:true, timeout:10000 })
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 429) {
      const data = error.response.data
      const retryHeader = Number(error.response.headers?.['retry-after'])
      const minutes = Number.isFinite(retryHeader) && retryHeader > 0
        ? Math.ceil(retryHeader / 60)
        : 5
      if (!data || typeof data === 'string') {
        error.response.data = {
          message: `操作过于频繁，请在 ${minutes} 分钟后重试`
        }
      }
    }
    return Promise.reject(error)
  }
)
export const reportEvent = (eventType, metadata={}) => api.post('/events', { eventType, metadata }).catch(()=>{})
