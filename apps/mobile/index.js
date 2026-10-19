// Explicit entry point for the npm-workspace monorepo.
//
// Expo's default entry (node_modules/expo/AppEntry.js) does
// `import App from '../../App'`. With npm workspaces hoisting `expo` to the
// repo ROOT, that relative import lands on <repo>/App.tsx — a file that does
// not exist (the app lives at apps/mobile/App.tsx), so Metro fails with
// "Unable to resolve ../../App". Registering the root component explicitly
// keeps all resolution inside apps/mobile regardless of hoist layout.
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
