export const staffingId = (value: any): string => String(value?.id || value?._id || '')
export const staffingDate = (value: any): string => value ? new Date(value).toLocaleString() : 'Not specified'
export const staffingState = (value: any): string => String(value || 'draft').replaceAll('_', ' ')
export function useStaffingOverview(key = 'staffing-overview') {
  const requestFetch = useRequestFetch()
  return useAsyncData<any>(key, () => requestFetch('/api/staffing/overview'))
}
export function useStaffingMutation(refresh?: () => Promise<any>) {
  const busy = ref(false)
  const message = ref('')
  const failure = ref(false)
  async function run(action: () => Promise<any>, success = 'Saved.') {
    if (busy.value) return null
    busy.value = true
    failure.value = false
    message.value = ''
    try {
      const result = await action()
      if (refresh) await refresh()
      message.value = success
      return result
    } catch (error: any) {
      failure.value = true
      message.value = apiErrorMessage(error, 'The action could not be completed. Please refresh and try again.')
      return null
    } finally { busy.value = false }
  }
  return { busy, message, failure, run }
}
