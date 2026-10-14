# Hosting the Java IDE

How to put the IDE on the web so other people can use it. To run it on your own computer, see
[RUNNING.md](RUNNING.md).

## 1. What you are hosting

The IDE is a set of **static files**: HTML, JavaScript, CSS and two small Java archives. There is no
server-side code, no database and nothing to configure at runtime. All Java compilation and
execution happens in each visitor's browser, so your server does no computing work for them: the
only cost that grows with visitors is bandwidth (about 5 MB per first visit), which free static
hosts cover comfortably for a class-sized audience.

| Part | Where it comes from | Size |
|---|---|---|
| The IDE (editor, interface, compiler `tools.jar`, bridge) | **Your** hosting | About 16 MB on disk; each visitor downloads about 5 MB of it |
| The Java runtime (CheerpJ) | CheerpJ's CDN, `cjrtnc.leaningtech.com` | About 17 MB per first visit |

### Licence conditions

The IDE uses the free **CheerpJ Community licence**, which covers personal projects, open-source
projects and technical evaluations. Two conditions affect hosting:

- **Keep the credit.** The status bar credits "CheerpJ by Leaning Technologies". Do not remove it.
- **Do not copy CheerpJ's own files to your server.** Hosting *the IDE* is fine; hosting *the CheerpJ
  runtime* ("self-hosting") needs a paid Commercial Licence. The IDE already loads CheerpJ from
  Leaning Technologies' CDN, so as long as you host the build output unchanged, you comply.

Commercial or team use needs a Commercial Licence: see https://cheerpj.com/licensing/.

## 2. Build the files

```bash
npm install
npm run build
```

This creates a `dist/` folder. **Its contents are the whole website.**

### Hosting at a sub-path

If the IDE will live at an address like `https://example.com/java-ide/` rather than at the root of
a domain, tell the build the folder name, **without slashes**:

```bash
BASE_PATH=java-ide npm run build          # macOS, Linux, Git Bash
```

```powershell
$env:BASE_PATH = 'java-ide'; npm run build   # Windows PowerShell
```

Leave `BASE_PATH` unset when hosting at the root of a domain (for example on Netlify, or a
`username.github.io` site).

> Why no slashes: Git Bash on Windows rewrites arguments that start with `/` into Windows paths,
> which silently produces a broken build.

## 3. Choose a host

Any static file host works. The host needs no special settings: no server code, no custom headers,
no redirects. The three options below are free for this kind of project.

### Option A: GitHub Pages (recommended for a university project)

The repository includes a ready workflow, [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml),
that tests, builds and publishes the IDE every time you push to `master`.

1. Create a repository on GitHub and push the project to it:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin master
   ```
2. On GitHub, open the repository's **Settings → Pages**, and under **Build and deployment**, set
   **Source** to **GitHub Actions**.
3. Open the **Actions** tab. The **Deploy to GitHub Pages** workflow runs on the push (or run it with
   **Run workflow**). When it finishes, the IDE is live at
   `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

The workflow sets `BASE_PATH` to the repository name automatically. If the repository is named
`YOUR-USERNAME.github.io`, edit the workflow and remove the `BASE_PATH` line, because that site is
served from the root.

Note: GitHub Pages on a free account requires the repository to be **public**, which publishes the
source code. Check whether your university has any rules about publishing assessed work before the
dissertation is marked.

### Option B: Netlify

1. Sign in at https://app.netlify.com and choose **Add new site → Import an existing project**.
2. Connect the Git repository.
3. Set **Build command** to `npm run build` and **Publish directory** to `dist`.
4. Deploy. The IDE is served at the root of the Netlify address, so do not set `BASE_PATH`.

For a one-off upload without Git, run `npm run build` and drag the `dist` folder onto the Netlify
**Sites** page.

### Option C: Any other web server

Copy the **contents** of `dist/` into a folder your web server serves. For example, with Apache or
nginx, copy them into the site's document root (or a sub-folder, built with `BASE_PATH`). Upload
all files unchanged: the `.jar` files must keep their names.

The server does not need to support HTTP range requests; this was tested with Python's basic
`http.server`, which does not support them, and the IDE worked.

## 4. Check the deployment

Open the hosted address and check:

1. The status bar shows **Loading Java runtime…** with a percentage, then **Ready** (allow up to a
   minute on a slow connection).
2. Click **Run**: the console shows `Hello, World!` and `Program finished with exit code 0`.
3. Choose **Examples → Console input (Scanner)**, run it, and type a name: the program answers.
4. The status bar shows the **CheerpJ by Leaning Technologies** credit.

If step 1 never finishes, open the browser's developer tools (`F12`), go to the **Network** tab,
reload, and look for failed requests:

| Failing request | Cause | Fix |
|---|---|---|
| `…/assets/index-….js` returns 404 | Built for the wrong location | Rebuild with the correct `BASE_PATH` (section 2) |
| `…/lib/tools.jar` or `…/runtime/ide-bridge.jar` returns 404 | Those files were not uploaded, or a host renamed them | Upload the whole `dist/` folder unchanged |
| Requests to `cjrtnc.leaningtech.com` fail | The visitor's network blocks CheerpJ's CDN | Nothing to fix on your server; the network must allow that address |

## 5. Updating the site

- **GitHub Pages / Netlify with Git:** push to the branch; the site rebuilds and redeploys itself.
- **Manual hosting:** run `npm run build` again and replace the old files with the new `dist/`
  contents. The file names inside `assets/` change on every build, so delete the old `assets/`
  folder rather than copying on top of it.

Visitors' saved code is kept in their own browser, so redeploying never loses it.
