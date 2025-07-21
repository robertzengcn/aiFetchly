import { windowInvoke } from '@/views/utils/apirequest'
import { CHOOSEFILEDIALOG } from '@/config/channellist'
export async function chooseFileDialog(): Promise<any> {
    return await windowInvoke(CHOOSEFILEDIALOG);
}