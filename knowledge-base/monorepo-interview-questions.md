# 大仓项目问题与答案<br>Monorepo Project Questions and Answers

## 请整体介绍一下 Monorepo 大仓项目。为什么要做、你负责什么、当前规模和核心价值是什么？AI 时代为什么还需要大仓和前端基建，如何衡量它是否成功？<br>Please introduce the Monorepo project. Why did you build it? What was your role? What is its size and main value? Why do we still need infrastructure in the AI era, and how do you measure success?

我是消金运营组前端大仓技术负责人，负责 B 端系统的研发规范、构建部署、组件体系、质量门禁和 AI 基建。这个大仓目前承载 23 个项目、12 个业务包和 22 个公共包，我主导推动了 8 个以上项目迁入。<br>
I am the technical owner of our frontend monorepo. I am responsible for development rules, build and deployment, shared components, quality checks, and AI coding infrastructure for our B-end systems. The monorepo now has 23 projects, 12 business packages, and 22 shared packages. I led the move of more than eight projects into it.

我们建设大仓，不是为了把代码放进同一个仓库，而是为了解决分散多仓下反复出现的四类问题：工程配置和研发流程不一致、公共能力重复建设、依赖与版本难以统一治理，以及跨项目经验难以沉淀。它的核心价值可以概括为“整体提效、统一治理、能力复用”。<br>
We did not build the monorepo just to put all code in one place. We wanted to solve four common problems: different project settings and development flows, repeated work on shared tools, hard dependency and version management, and poor knowledge sharing across projects. Its main value is better team efficiency, shared rules, and reuse.

我主要做了五件事：<br>
I mainly did five things:

1. 统一目录结构、依赖管理、构建配置和代码规范，让不同项目共享同一套工程底座。<br>
   I unified the folder structure, dependency management, build settings, and coding rules. Different projects can now use the same engineering base.
2. 建设统一请求库，集中拉取并复用远端请求代码，形成跨包共享的 API 合约入口，流水线构建耗时缩短 50 秒。<br>
   I built a shared request library. It pulls and reuses remote API code in one place and gives packages one shared API contract. This cut 50 seconds from the pipeline build time.
3. 统一流水线和部署规范，通过缓存、并行和构建升级，把构建流水线从 5 分钟降到 2 分钟内，MR 全量构建从 8 分钟降到 3 分钟。<br>
   I unified the pipeline and deployment rules. With caching, parallel tasks, and build upgrades, the build pipeline went from five minutes to under two minutes. The full MR build went from eight minutes to three minutes.
4. 推动旧框架迁移到公司级框架，在尽量不改业务代码的前提下统一运行时和构建底座，页面 LCP 降低约 30%，构建耗时缩短 1 到 2 分钟，产物大小减少 21%，CloudIDE 首屏从 50 秒降到 4 秒。<br>
   I moved old projects to the company-level framework. We kept most business code unchanged while unifying the runtime and build base. Page LCP dropped by about 30%. Build time was one to two minutes shorter. Output size dropped by 21%, and the CloudIDE first screen went from 50 seconds to 4 seconds.
5. 沉淀 Arco ProTable 和 Formily 的 CRUD 页面范式，并把 ESLint、TypeScript、文件大小限制等质量门禁接入 Agent 编码链路，使 AI 辅助下可以在 10 分钟内完成一个 CRUD 页面。<br>
   I created a standard CRUD pattern with Arco ProTable and Formily. I also added ESLint, TypeScript checks, and file-size limits to the Agent coding flow. With AI support, we can build a standard CRUD page in ten minutes.

AI 时代仍然需要基建。AI 降低的是代码生成成本，但如果没有统一的组件、接口、目录规范和验证机制，它也会加速重复实现、技术选型分散和代码熵增。过去基建更多解决“人怎么写得更快”，现在还要解决“Agent 怎样获得稳定上下文、遵守工程约束并验证结果”。简单、低风险、低复用的代码可以让 AI 按需生成；高复用、高风险、需要长期治理的能力仍然应该基建化。<br>
We still need infrastructure in the AI era. AI makes code cheaper to create, but without shared components, APIs, folder rules, and checks, it can also create more repeated code and more technical choices. In the past, infrastructure mainly helped people code faster. Now it must also give Agents clear context, engineering rules, and a way to check their work. AI can create simple, low-risk code when needed. But shared and high-risk abilities still need strong infrastructure.

衡量大仓是否成功，不能只看迁入了多少项目，还要同时看公共能力是否被稳定采用、研发反馈是否更快、业务开发是否提效、变更风险是否可控，以及统一之后增加的治理成本是否值得。上面的覆盖规模、流水线耗时、框架迁移效果、CRUD 效率和 AI 评测结果，分别对应采用范围、研发效率、运行效果和质量结果。<br>
The number of moved projects is not enough to show success. I also check whether teams keep using the shared tools, whether feedback is faster, whether business development is more efficient, whether change risk is under control, and whether the extra management cost is worth it. Project coverage, pipeline time, framework results, CRUD speed, and AI evaluation results show these different kinds of value.

## 大仓项目真正难在哪里？面对业务团队反对或缺少迁移动力时，你如何判断哪些基建值得做，并推动它们落地？<br>What is the hardest part of a Monorepo project? When business teams do not want to migrate, how do you decide what to build and how do you move it forward?

大仓最难的不是搭建 Monorepo，而是让团队收益、项目成本和改造风险达到平衡。一个方案在技术上正确，不代表业务团队愿意承担迁移和回归成本，所以我会先看三个维度：团队收益、使用者收益和改造风险，再选择不同的推进方式。<br>
The hardest part is not setting up the monorepo. It is balancing team value, project cost, and change risk. A technically correct plan may still be too costly for a business team. I first look at team value, user value, and change risk. Then I choose how to move it forward.

1. **高收益、低风险**：把能力产品化，让体验和结果推动自然采用。例如 ProTable 能明显降低 CRUD 页面的开发成本，这类能力不需要强推。<br>
   **High value and low risk**: Make it easy to use and let the result drive adoption. For example, ProTable clearly reduces CRUD work, so teams are willing to use it.
2. **团队收益高，但个人感知不强**：重点降低接入成本。例如统一请求库和流水线，不要求一次性重写旧代码，而是提供迁移脚本、兼容方案、文档和联调支持，让存量代码保持不动、新代码逐步使用新规范，再配合项目负责人和迁移节奏完成收敛。<br>
   **High team value but low personal value**: Reduce the cost of adoption. For the shared request library and pipeline, we did not ask teams to rewrite old code at once. We provided migration scripts, a compatible solution, documents, and support. Old code could stay, while new code followed the new rules step by step.
3. **高收益、高风险**：先由我完成样板项目，在真实业务中验证兼容性和收益，再通过分阶段迁移、灰度、监控和回滚降低风险。成功案例能够把“理论上可行”变成“已经被证明可控”。<br>
   **High value and high risk**: I first built a pilot project and checked it in a real business system. Then we used staged migration, gradual rollout, monitoring, and rollback to reduce risk. A successful pilot turns an idea into a proven plan.
4. **低收益、高风险**：不为了形式统一而强推。基建的目标是解决跨项目反复发生的问题，不是追求所有项目看起来完全一样。<br>
   **Low value and high risk**: Do not force it only for consistency. Infrastructure should solve repeated cross-project problems. It should not make every project look exactly the same.

我的角色是技术负责人而不是人员绩效管理者。我负责识别问题、制定技术标准、完成核心方案、推动迁移并对工程结果负责；具体业务排期仍需要和各项目负责人协同。最终推动 8 个以上项目迁入大仓，靠的不是行政要求，而是把迁移成本和风险降到业务团队可以接受的范围。<br>
I am a technical owner, not a people manager. I find problems, set technical rules, build the core solution, drive migration, and take responsibility for engineering results. Business schedules still need work with each project owner. More than eight projects moved into the monorepo because we reduced the cost and risk to an acceptable level, not because we forced them.

## Monorepo 带来了哪些新问题？多个项目放入大仓后，如何兼顾统一治理、开发体验和独立发布？<br>What new problems does a Monorepo bring? How do you keep shared management, a good developer experience, and independent releases?

大仓不是只有收益。统一之后，公共能力的影响面被放大，所以它必须和治理体系一起建设，主要有五类问题：<br>
A monorepo does not only bring benefits. A change to shared code can affect many projects, so the monorepo needs strong management in five areas:

1. **迁移成本**：存量项目要处理目录调整、构建适配、依赖收敛和历史兼容。应通过兼容层和分项目迁移降低一次性改造风险。<br>
   **Migration cost**: Old projects need folder changes, build changes, dependency cleanup, and backward compatibility. A compatibility layer and project-by-project migration reduce the risk.
2. **依赖治理**：共享工作区会更容易暴露重复依赖、版本冲突和幽灵依赖。需要统一包管理策略、锁文件和依赖检查，关键宿主依赖还要保证单例。<br>
   **Dependency management**: A shared workspace can expose duplicate packages, version conflicts, and hidden dependencies. We need one package strategy, one lockfile, and dependency checks. Important host packages must have only one copy.
3. **变更影响面**：公共包、构建配置和请求库的改动可能影响多个项目。必须通过类型检查、单测、受影响项目构建、集成验证和灰度控制影响范围。<br>
   **Change impact**: A change to a shared package, build setting, or request library may affect many projects. We use type checks, unit tests, builds of affected projects, integration checks, and gradual rollout.
4. **仓库性能**：如果任何改动都全量安装、构建和测试，大仓会拖慢反馈速度。需要依赖图、按影响范围执行、任务并行和缓存。<br>
   **Repository speed**: If every change installs, builds, and tests everything, feedback becomes slow. We use a dependency graph, affected-project tasks, parallel jobs, and caching.
5. **规范收敛成本**：不能要求所有存量项目一次性改完。更现实的方式是保留兼容边界，先统一高收益能力，再逐步减少差异。<br>
   **Cost of shared rules**: We cannot change every old project at once. We keep a compatible boundary, unify high-value parts first, and reduce differences step by step.

大仓统一的是工程底座，不等于把所有应用绑成一个发布单元。每个业务项目仍应保持清晰的应用边界，可以独立开发、构建和发布；公共包则有独立的测试和版本边界。这样既能共享基建，也不会让一个项目的发布被其他项目阻塞。<br>
The monorepo unifies the engineering base. It does not make all apps one release unit. Each business project keeps a clear boundary and can be developed, built, and released on its own. Shared packages also have their own test and version boundaries. This gives us reuse without blocking one project because of another project.

## 22 个公共包是如何确定拆分粒度的？怎样避免拆得过粗或过细，并处理业务包、宿主依赖和多版本问题？<br>How did you decide the size of the 22 shared packages? How do you avoid packages that are too large or too small, and how do you manage business packages, host dependencies, and different versions?

公共包不能只因为“两个项目都用过”就抽取。我会看四个边界：<br>
I do not create a shared package only because two projects once used the same code. I check four boundaries:

1. **职责边界**：一个包应该解决一类稳定问题，变更原因尽量一致。<br>
   **Responsibility**: One package should solve one stable type of problem. Its parts should change for the same reason.
2. **依赖边界**：依赖方向要清晰，底层公共包不能反向依赖具体业务。<br>
   **Dependencies**: The dependency direction must be clear. A low-level shared package must not depend on one business project.
3. **复用边界**：至少存在稳定的跨项目复用价值，而不是为一次复用提前抽象。<br>
   **Reuse**: The package should have stable value across projects. We should not create it for only one reuse case.
4. **发布与测试边界**：如果一项能力需要独立演进、测试或版本管理，才有充分理由拆成包。<br>
   **Release and test**: A separate package makes sense when the ability needs its own changes, tests, or versions.

拆得太粗，会导致任何改动都影响大量使用方；拆得太细，又会增加包数量、版本协同和理解成本。因此我倾向先按完整能力域拆分，例如请求、表格表单、特性开关、代码规范，而不是按零散函数拆包。<br>
If a package is too large, every change affects many users. If packages are too small, there are too many packages and versions to manage. I prefer complete ability areas, such as requests, tables and forms, feature flags, and coding rules. I do not create one package for every small function.

业务包和公共包的区别在于：公共包只依赖稳定的技术协议，面向多个业务复用；业务包可以包含某一类业务能力，但需要通过配置、接口和扩展点隔离具体系统，不能把某个项目的页面和状态直接搬进公共层。<br>
A shared package depends only on stable technical contracts and can be used by many businesses. A business package can contain one type of business ability, but it must use settings, APIs, and extension points to stay separate from one specific system. We should not move one project's pages and state directly into the shared layer.

依赖治理上，React 这类由应用提供、必须保持单例的宿主依赖应声明兼容范围，避免组件包再安装一份；应用根部再通过锁文件和版本约束统一实际版本。发布前需要验证类型、单测、典型项目集成和破坏性变更，不能只保证公共包自身可以构建。<br>
For dependencies such as React, the app should provide the package and keep only one copy. A component package should declare the versions it supports instead of installing another React. The app root uses the lockfile and version rules to choose the real version. Before release, we check types, unit tests, common app integrations, and breaking changes. A successful package build is not enough.

## 为什么要建设统一请求库？远端请求代码如何集中拉取和跨包复用，怎样避免重复生成或把无关代码全部打进业务产物？<br>Why did you build a shared request library? How do you pull and reuse remote API code, avoid repeated generation, and keep unused code out of the business bundle?

分散多仓时，每个项目都会各自维护请求封装，并重复拉取和生成后端接口代码。这不仅浪费构建时间，也会造成调用方式、错误处理和接口理解不一致。统一请求库主要解决三个问题：统一调用方式、集中生成 API 合约、复用相同服务的请求代码。<br>
With many separate repositories, every project kept its own request wrapper and pulled and generated backend API code again. This wasted build time and created different request styles, error handling, and API understanding. The shared request library gives us one request style, one place to generate API contracts, and reuse of the same service code.

实现上，由统一配置声明服务、分支和接口描述来源，流水线集中拉取并生成请求代码，各业务包再通过稳定的 API 合约入口引用。原来主包和子包可能重复下载、重复生成同一批服务代码；收敛后只执行一次并让多个项目复用，流水线构建耗时因此缩短了 50 秒。<br>
A shared config defines the service, branch, and API description source. The pipeline pulls and generates the request code in one place. Business packages use it through a stable API contract. Before this change, parent and child packages could download and generate the same service code many times. Now we do it once and reuse it. This cut 50 seconds from the pipeline build time.

“使用公共请求包”不等于业务产物必然包含整个包。最终产物取决于模块导出方式、静态分析和 Tree Shaking 是否生效。我会保持接口按服务或能力域导出，避免有副作用的顶层代码，并通过构建产物分析确认未使用模块是否被移除。如果当前生成格式无法可靠 Tree Shaking，就继续按服务拆分入口，而不是只凭理论判断包体积。<br>
Using a shared request package does not mean the final bundle contains the whole package. It depends on module exports, static analysis, and Tree Shaking. I export APIs by service or ability area, avoid top-level code with side effects, and check the final bundle to make sure unused modules are removed. If Tree Shaking is not reliable for the generated format, I split the entry points by service instead of guessing about bundle size.

## 流水线为什么能从 5 分钟降到 2 分钟内、MR 全量构建从 8 分钟降到 3 分钟？公共包修改后，又如何避免项目 A 正常、项目 B 失败？<br>How did you reduce the pipeline from five minutes to under two minutes and the full MR build from eight minutes to three minutes? How do you stop a shared-package change from working in project A but breaking project B?

流水线优化不是单点加速，而是先拆解安装依赖、仓库检查、Lint、构建和单元测试，再分别判断哪些步骤可以缓存、并行或消除重复工作。<br>
The pipeline improvement did not come from one change. We first separated dependency installation, repository checks, Lint, builds, and unit tests. Then we decided which steps could use cache, run in parallel, or remove repeated work.

1. 依赖安装和稳定构建产物使用缓存，缓存键要包含代码、锁文件、Node 环境和上游依赖变化。<br>
   We cache dependency installation and stable build output. The cache key includes code, the lockfile, the Node environment, and changes in upstream packages.
2. Build、Lint、TypeScript 检查和不依赖构建产物的测试尽量并行，减少串行等待。<br>
   We run builds, Lint, TypeScript checks, and tests that do not need build output in parallel when possible.
3. 依据项目与公共包的依赖图计算受影响范围，没有变化且依赖未变化的项目直接复用缓存。<br>
   We use the dependency graph to find affected projects. A project can reuse cache when neither its code nor its dependencies changed.
4. 将原来各项目重复执行的远端请求代码拉取和生成收敛到统一请求包，消除重复网络请求和生成时间。<br>
   We moved repeated remote API pulls and code generation into one shared request package. This removed repeated network calls and generation work.

公共包的风险不能只靠它自己的测试来控制。我会分层处理：公共包自身先过类型检查、Lint 和单测；再根据依赖图构建受影响项目；关键能力补典型项目集成测试；运行时无法被构建覆盖的问题，再通过预发布、浏览器验证、灰度和监控发现。也就是说，全量构建只是基础保障，不能把“构建成功”等同于“业务一定正确”。<br>
Tests inside the shared package are not enough. I use several layers. First, the package passes type checks, Lint, and unit tests. Next, we build affected projects from the dependency graph. Important abilities also have integration checks in common projects. For runtime problems that builds cannot find, we use pre-release checks, browser verification, gradual rollout, and monitoring. A successful full build does not mean the business is fully correct.

## 为什么要迁移旧框架？最难的技术问题是什么，为什么选择 Rsbuild 兼容和适配层，而不是大规模重写业务代码？你如何灰度、回滚并解释最终性能收益？<br>Why did you migrate the old framework? What was the hardest technical problem? Why did you use Rsbuild and a compatibility layer instead of rewriting business code? How did you roll it out, roll it back, and explain the performance result?

这次迁移真正困难的不是替换构建命令，而是在不批量修改多个存量系统页面代码的前提下，兼容旧框架已经承载的入口、路由、布局和运行时契约。旧框架长期积累了很多隐含能力，业务系统又不可能一次性回归所有低频页面，所以最大的风险是“构建成功，但运行时仍有遗漏”。<br>
The hard part was not changing the build command. It was keeping the old entry, routes, layout, and runtime contracts without changing many business pages. The old framework had many hidden abilities built over time. We could not test every low-use page at once. The biggest risk was that the build could pass while runtime problems still remained.

我先梳理旧框架边界，明确哪些属于构建能力、哪些属于运行时约定、哪些必须继续兼容。然后在新底座和旧业务之间增加适配层，通过 Rsbuild 兼容原有构建方式，把主要改动控制在工程层，让业务页面尽量保持不动。相比直接重写，这个方案有三个优势：功能回归面更小、业务团队投入更低、构建和运行时升级的收益可以更早释放。<br>
I first studied the boundary of the old framework. I separated build features, runtime rules, and contracts that we still had to support. Then I added a compatibility layer between the new base and the old business code. Rsbuild kept the old build behavior, so most changes stayed in the engineering layer and most business pages stayed unchanged. This reduced the test area, reduced work for business teams, and gave us build and runtime benefits sooner.

迁移不是一次性切换。我会先选择样板项目，完成构建、核心页面和关键链路验证；随后按项目分阶段灰度，比较错误、性能和业务指标；出现问题立即回退，修复后重新上线。对无法全量回归的低频功能，则延长灰度时间，并邀请熟悉业务的用户参与验证。只有成功案例和指标证明风险可控后，才扩大迁移范围。<br>
We did not switch everything at once. I first chose a pilot project and checked its build, core pages, and key user flows. Then we rolled out project by project and watched errors, performance, and business results. If a problem appeared, we rolled back, fixed it, and released again. For low-use features that were hard to fully test, we used a longer rollout and asked users who knew the business to help. We expanded only after real results showed that the risk was under control.

最终统一运行时和构建底座后，页面 LCP 降低约 30%，构建耗时缩短 1 到 2 分钟，产物大小减少 21%，CloudIDE 首屏从 50 秒降到 4 秒。这里不能把 LCP 改善简单归因于 React 升级；它是框架与运行时升级、异步加载、请求并行等多项改造的综合结果。更严谨的做法是固定页面、数据和环境，分别比较各阶段指标，再说明每项改造的贡献。<br>
After we unified the runtime and build base, page LCP dropped by about 30%, build time was one to two minutes shorter, output size dropped by 21%, and the CloudIDE first screen went from 50 seconds to 4 seconds. I would not say that the LCP result came only from the React upgrade. It came from several changes, including the framework, runtime, lazy loading, and parallel requests. To explain it clearly, I compare the same pages, data, and environment at each step.

从工具关系看，Webpack 和 Rspack 属于打包器，Rsbuild 是建立在 Rspack 之上的上层构建工具，提供更完整的默认配置和工程能力；Vite 是另一套开发与构建工具链。项目选择 Rsbuild 的关键不是追求某个工具名，而是它符合公司级框架方向，并且能够通过兼容层降低存量迁移成本。<br>
Webpack and Rspack are bundlers. Rsbuild is a higher-level build tool on top of Rspack and provides more ready-to-use engineering features. Vite is another development and build toolchain. We chose Rsbuild because it matched the company-level framework and helped us lower migration cost through compatibility. We did not choose it only because it was a new tool.

## ProTable 和 Formily 解决了什么问题？最复杂的设计点是什么，为什么可以在 AI 辅助下十分钟完成一个 CRUD 页面？<br>What problems do ProTable and Formily solve? What are the hardest design points, and why can you build a CRUD page in ten minutes with AI support?

我做的不是简单复制一个表格组件，而是把团队高频的查询、表格、表单、接口调用和页面验证收敛成稳定范式。Arco ProTable 负责统一表格查询和数据展示协议，表单部分使用 Formily，把字段、校验、联动和布局配置化，并保留自定义渲染和业务扩展能力。<br>
I did not simply copy a table component. I turned common queries, tables, forms, API calls, and page checks into one stable pattern. Arco ProTable gives us one contract for table queries and data display. Formily makes fields, validation, links between fields, and layout configurable. It also keeps custom rendering and business extension points.

真正需要设计的是几个边界：Schema 怎样同时描述查询和表格字段；Formily 实例、提交动作和表格请求怎样联动；业务组件如何通过扩展点接入而不侵入内核；受控状态、字段联动和重复渲染怎样控制；AI 生成的配置如何继续满足权限、异常处理和团队规范。<br>
The main work was designing clear boundaries: how one schema describes query and table fields, how Formily submit actions work with table requests, how business components use extension points without changing the core, how to manage controlled state and avoid extra renders, and how AI-generated settings still follow permission, error-handling, and team rules.

十分钟完成 CRUD 页面的前提不是模型从零发明页面，而是仓库已经具备三类资产：稳定的 ProTable 与 Formily 组件范式、压缩后的组件使用知识，以及接口合约和业务布局规则。Agent 主要填充字段、查询条件和业务规则，生成后还要经过静态检查和浏览器验证。这个指标证明的是“标准场景被高度产品化”，不代表所有复杂业务页面都能在十分钟内完成。<br>
A ten-minute CRUD page does not mean the model creates everything from zero. The repository already has three assets: a stable ProTable and Formily pattern, short and clear component knowledge, and API contracts and layout rules. The Agent mainly fills in fields, query conditions, and business rules. After generation, it still runs static checks and browser verification. Ten minutes applies to standard CRUD pages, not every complex business page.

## 大仓为什么能让 Agent 更稳定地理解和修改代码？前后端分属不同仓库时，如何组织统一工作空间、过滤无关代码并处理跨仓权限？<br>Why does the Monorepo help an Agent understand and change code more reliably? When frontend and backend are in different repositories, how do you create one workspace, remove unrelated code, and handle permissions?

大仓对 Agent 的价值，不是让模型一次读取所有代码，而是提供稳定的结构、统一的约定和可检索的知识入口。目录结构、请求方式、组件范式、构建命令和质量规则统一后，Agent 不需要为每个项目重新猜测工程习惯。<br>
The monorepo does not help by making the model read all code at once. It gives the Agent a stable structure, shared rules, and clear ways to find knowledge. With one folder structure, request style, component pattern, build command, and quality rule set, the Agent does not need to guess how each project works.

对于前后端分属不同仓库的场景，我通过 Git submodule 将相关仓库组织成统一工作空间，使 Agent 可以在同一个任务视图中完成技术设计、前后端修改、联调和验证。上下文仍然要按层次提供：<br>
When frontend and backend are in different repositories, I use Git submodule to put the related repositories into one workspace. The Agent can then do technical design, frontend and backend changes, integration, and verification in one task view. But context still needs clear layers:

1. 根目录只放跨项目通用的规则和导航，不把所有业务知识一次性注入。<br>
   The root only contains shared rules and navigation. We do not put all business knowledge into the context at once.
2. 项目和业务知识放在对应目录，通过 AGENTS、Skills 和知识召回按需读取。<br>
   Project and business knowledge stays in the related folder. AGENTS, Skills, and knowledge search load it only when needed.
3. 根据当前任务限定搜索目录，忽略无关项目、构建产物和大体积生成代码，避免上下文被噪声占满。<br>
   We limit search to the folders needed by the task. We ignore unrelated projects, build output, and large generated files so they do not fill the context.
4. 公共仓库没有编辑权限时，Agent 只能读取和引用，修改应在有权限的仓库内通过适配层完成，或者拆成独立变更交给对应负责人，不能为了完成任务绕过权限边界。<br>
   If the Agent cannot edit a shared repository, it can only read and use it. We make the change through an adapter in a repository we can edit, or create a separate change for the right owner. We never bypass permissions just to finish the task.

知识也不能写完就默认永远正确。产品需求或代码变化时，知识应和代码一起评审、版本化和更新；无法确认的新规则不直接固化。最终还要通过真实需求评测和运行验证判断知识是否被正确召回。当前全栈 AI 研发体系基于真实需求建立评测集，用例通过率达到 92%。<br>
Knowledge does not stay correct forever. When product needs or code change, we review, version, and update the knowledge with the code. We do not save a new rule when we cannot confirm it. We also use real task evaluations and runtime checks to see whether the right knowledge was found. The current full-stack AI development system has a 92% test-case pass rate on real development tasks.

## AI 写代码越来越快，人工 Review 跟不上时，大仓如何通过质量门禁和浏览器验证避免代码劣化？<br>AI writes code faster than people can review it. How does the Monorepo use quality checks and browser verification to stop code quality from getting worse?

我的整体思路是“生成前约束、生成后分层验证、失败后自愈”，而不是把质量责任交给最后一次人工 Review。<br>
My approach is simple: give rules before generation, use several checks after generation, and let the Agent fix failures. Quality should not depend only on the final human review.

1. **上下文约束**：先让 Agent 获得目录规范、公共组件、请求方式和业务知识，减少一开始就选错方案。<br>
   **Context rules**: Give the Agent folder rules, shared components, request patterns, and business knowledge first. This reduces wrong choices at the start.
2. **静态门禁**：代码修改后自动执行 ESLint、TypeScript 类型检查和文件大小限制，拦住可以机械判断的问题。<br>
   **Static checks**: After a code change, run ESLint, TypeScript checks, and file-size limits. These stop problems that tools can judge directly.
3. **语义审查**：通过 Code Review 检查静态规则难以发现的业务约束、边界处理和不合理实现。<br>
   **Code Review**: Review business rules, edge cases, and poor designs that static tools cannot easily find.
4. **浏览器验证**：启动真实开发服务，在受控测试环境中访问目标页面，检查页面能否打开、交互是否正确、接口业务状态是否成功，而不是只看 HTTP 状态或构建结果。<br>
   **Browser verification**: Start the real development service and open the target page in a controlled test environment. Check that the page opens, user actions work, and the API business result is successful. Do not only check the HTTP status or build result.
5. **自愈闭环**：任何一层失败后，Agent 根据错误定位问题、修改代码并重新执行验证，全部通过后再进入人工 Review。<br>
   **Self-fixing loop**: If any check fails, the Agent finds the problem, changes the code, and runs the checks again. Human review starts only after all checks pass.

对于存量技术债，我不会要求 AI 一次性重写，而是采用存量与增量分治：旧代码保持稳定，新代码进入规范更严格的区域，通过门禁逐步阻止新的技术债继续增长。这样大仓既提供统一约束，也保留人工对业务判断、架构取舍和最终结果负责的边界。<br>
For old technical debt, I do not ask AI to rewrite everything at once. I separate old and new code. Old code stays stable, while new code goes into an area with stricter rules. Quality checks stop new debt from growing. The monorepo provides shared rules, but people still make business decisions, architecture trade-offs, and the final quality decision.
