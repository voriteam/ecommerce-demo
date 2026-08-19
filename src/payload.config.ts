import { sqliteAdapter } from '@payloadcms/db-sqlite'

import {
  BoldFeature,
  EXPERIMENTAL_TableFeature,
  IndentFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  UnderlineFeature,
  UnorderedListFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Categories } from '@/collections/Categories'
import { Media } from '@/collections/Media'
import { Pages } from '@/collections/Pages'
import { Users } from '@/collections/Users'
import { Footer } from '@/globals/Footer'
import { Header } from '@/globals/Header'
import { VoriSync } from '@/globals/VoriSync'
import { voriSyncEndpoint } from '@/endpoints/voriSync'
import { recordVoriTransactionTask } from '@/jobs/recordVoriTransaction'
import { syncVoriInventoryTask } from '@/jobs/syncVoriInventory'
import { plugins } from './plugins'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    components: {
      // The `BeforeLogin` component renders a message that you see while logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeLogin` statement on line 15.
      beforeLogin: ['@/components/BeforeLogin#BeforeLogin'],
      // The `BeforeDashboard` component renders the 'welcome' block that you see after logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeDashboard` statement on line 15.
      beforeDashboard: ['@/components/BeforeDashboard#BeforeDashboard'],
    },
    user: Users.slug,
  },
  collections: [Users, Pages, Categories, Media],
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URI || 'file:./ecommerce-demo.db',
    },
    migrationDir: path.resolve(dirname, 'migrations'),
    // In development the schema is pushed straight from the config so a fresh
    // clone boots without a migration step. In production it is not: Fly runs
    // `payload migrate` against the mounted volume before the server starts,
    // so a deploy can never silently reshape a database holding demo orders.
    push: process.env.NODE_ENV !== 'production',
  }),
  editor: lexicalEditor({
    features: () => {
      return [
        UnderlineFeature(),
        BoldFeature(),
        ItalicFeature(),
        OrderedListFeature(),
        UnorderedListFeature(),
        LinkFeature({
          enabledCollections: ['pages'],
          fields: ({ defaultFields }) => {
            const defaultFieldsWithoutUrl = defaultFields.filter((field) => {
              if ('name' in field && field.name === 'url') return false
              return true
            })

            return [
              ...defaultFieldsWithoutUrl,
              {
                name: 'url',
                type: 'text',
                admin: {
                  condition: ({ linkType }) => linkType !== 'internal',
                },
                label: ({ t }) => t('fields:enterURL'),
                required: true,
              },
            ]
          },
        }),
        IndentFeature(),
        EXPERIMENTAL_TableFeature(),
      ]
    },
  }),
  //email: nodemailerAdapter(),
  endpoints: [voriSyncEndpoint],
  globals: [Header, Footer, VoriSync],
  jobs: {
    // autoRun both schedules tasks that declare a `schedule` and runs whatever
    // is waiting on the queue. Running it in-process is deliberate: the
    // inventory poll is the demo, and it must not be at the mercy of a
    // platform's cron tiering. It does require the machine to stay up — see
    // `auto_stop_machines = false` in fly.toml.
    autoRun: [{ cron: '* * * * *', queue: 'vori' }],
    // The inventory sync declares a concurrency key so two runs cannot fight
    // over the watermark; that requires opting in here.
    enableConcurrencyControl: true,
    // The queue is driven by the scheduler above, not by an HTTP caller, so
    // there is no run endpoint to protect.
    shouldAutoRun: () => true,
    tasks: [syncVoriInventoryTask, recordVoriTransactionTask],
  },
  plugins,
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Sharp is now an optional dependency -
  // if you want to resize images, crop, set focal point, etc.
  // make sure to install it and pass it to the config.
  // sharp,
})
