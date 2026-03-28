import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('vsai', {
  // Will be populated in Task 2
});
