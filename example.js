// SPDX-FileCopyrightText: 2021 Anders Rune Jensen
//
// SPDX-License-Identifier: Unlicense

const Log = require('async-append-only-log')
const pull = require('pull-stream')
const JITDB = require('./index')
const {
  query,
  fromDB,
  and,
  or,
  slowEqual,
  equal,
  debug,
  author,
  paginate,
  toCallback,
  toPromise,
  toPullStream,
  toAsyncIter,
  descending,
} = require('./operators')
const { seekType, seekAuthor, seekVoteLink } = require('./test/helpers')

var raf = Log(process.argv[2], { blockSize: 64 * 1024 })

var db = JITDB(raf, './indexes')
db.onReady(async () => {
  // seems the cache needs to be warmed up to get fast results

  const staltzp = '@+UMKhpbzXAII+2/7ZlsgkJwIsxdfeFi36Z5Rk1gCfY0=.ed25519'
  const mix = '@ye+QM09iPcDJD6YvQYjoQc7sLF/IFhmNbEqgdzQo3lQ=.ed25519'
  const mixy = '@G98XybiXD/amO9S/UyBKnWTWZnSKYS3YVB/5osSRHvY=.ed25519'
  const arj = '@6CAxOI3f+LUOVrbAl0IemqiS7ATpQvr9Mdw9LC4+Uv0=.ed25519'
  const myroot = '%0cwmRpJFo5qtsesZYrf2TkufWIaxTzLiNhKUZdWNeJM=.sha256'

  if (false)
    query(
      fromDB(db),
      // debug(),
      and(slowEqual('value.content.type', 'vote')),
      // debug(),
      and(slowEqual('value.content.vote.expression', '⛵')),
      // debug(),
      and(slowEqual('value.author', staltzp)),
      // debug(),
      toCallback((err, results) => {
        console.log(results)
      })
    )

  if (false) {
    const before = Date.now()
    const results = await query(
      fromDB(db),
      // debug(),
      and(equal(seekType, 'blog', { indexType: 'type' })),
      // debug(),
      and(
        or(
          equal(seekAuthor, mix, { indexType: 'author' }),
          equal(seekAuthor, mixy, { indexType: 'author' })
        )
      ),
      // debug(),
      toPromise()
    )
    const duration = Date.now() - before
    console.log(`duration = ${duration}ms`)
    console.log(results.length)
  }

  if (true) {
    const before = Date.now()
    const results = await query(
      fromDB(db),
      or(
        // slowEqual('value.content.vote.link', myroot, { prefix: 32 })
        equal(seekVoteLink, myroot, { prefix: 32, indexType: 'vote_link' })
      ),
      toPromise()
    )
    const duration = Date.now() - before
    console.log(`duration = ${duration}ms`)
    console.log(results.length)
  }

  var i = 0
  if (false) {
    const results = query(
      fromDB(db),
      // debug(),
      and(type('blog')),
      // debug(),
      and(or(author(mix), author(mixy), author(arj))),
      // debug(),
      startFrom(6),
      // debug(),
      paginate(3),
      // debug(),
      toAsyncIter()
    )
    for await (let msgs of results) {
      console.log('page #' + i++)
      console.log(msgs)
    }
  }

  if (false) {
    console.time('get all posts from users')

    const posts = query(fromDB(db), and(type('post')))

    const postsMix = query(
      posts,
      // debug(),
      and(or(author(mix), author(mixy))),
      // debug(),
      toPromise()
    )

    const postsArj = query(
      posts,
      // debug(),
      and(author(arj)),
      // debug(),
      toPromise()
    )

    const [resMix, resArj] = await Promise.all([postsMix, postsArj])
    console.log('mix posts: ' + resMix.length)
    console.log('arj posts: ' + resArj.length)
    console.timeEnd('get all posts from users')
  }

  return

  db.query(
    {
      type: 'AND',
      data: [
        {
          type: 'EQUAL',
          data: { seek: db.seekType, value: 'post', indexType: 'type' },
        },
        {
          type: 'EQUAL',
          data: { seek: db.seekAuthor, value: staltzp, indexType: 'author' },
        },
      ],
    },
    (err, results) => {
      console.timeEnd('get all posts from user')

      console.time('get last 10 posts from user')

      db.query(
        {
          type: 'AND',
          data: [
            {
              type: 'EQUAL',
              data: { seek: db.seekType, value: 'post', indexType: 'type' },
            },
            {
              type: 'EQUAL',
              data: {
                seek: db.seekAuthor,
                value: staltzp,
                indexType: 'author',
              },
            },
          ],
        },
        0,
        10,
        (err, results) => {
          console.timeEnd('get last 10 posts from user')

          console.time('get top 50 posts')

          db.query(
            {
              type: 'EQUAL',
              data: {
                seek: db.seekType,
                value: 'post',
                indexType: 'type',
              },
            },
            0,
            50,
            (err, results) => {
              console.timeEnd('get top 50 posts')

              console.time('author + sequence')

              db.query(
                {
                  type: 'AND',
                  data: [
                    {
                      type: 'GT',
                      data: { indexName: 'sequence', value: 7000 },
                    },
                    {
                      type: 'EQUAL',
                      data: {
                        seek: db.seekAuthor,
                        value: staltzp,
                        indexType: 'author',
                      },
                    },
                  ],
                },
                (err, results) => {
                  console.timeEnd('author + sequence')

                  var hops = {}
                  const query = {
                    type: 'AND',
                    data: [
                      {
                        type: 'EQUAL',
                        data: {
                          seek: db.seekAuthor,
                          value: staltzp,
                          indexType: 'author',
                        },
                      },
                      {
                        type: 'EQUAL',
                        data: {
                          seek: db.seekType,
                          value: 'contact',
                          indexType: 'type',
                        },
                      },
                    ],
                  }
                  const isFeed = require('ssb-ref').isFeed

                  console.time('contacts for author')

                  db.query(query, (err, results) => {
                    results.forEach((data) => {
                      var from = data.value.author
                      var to = data.value.content.contact
                      var value =
                        data.value.content.blocking ||
                        data.value.content.flagged
                          ? -1
                          : data.value.content.following === true
                          ? 1
                          : -2

                      if (isFeed(from) && isFeed(to)) {
                        hops[from] = hops[from] || {}
                        hops[from][to] = value
                      }
                    })

                    console.timeEnd('contacts for author')
                    //console.log(hops)
                  })
                }
              )
            }
          )
        }
      )
    }
  )

  return

  console.time('get all')
  db.query(
    {
      type: 'EQUAL',
      data: { seek: db.seekAuthor, value: staltzp, indexType: 'author' },
    },
    (err, results) => {
      console.timeEnd('get all')
    }
  )
})
