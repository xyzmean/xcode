import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(onDone: LocalJSXCommandOnDone): Promise<null> {
  onDone('Report xCode issues at https://github.com/xyzmean/xcode/issues.')
  return null
}
