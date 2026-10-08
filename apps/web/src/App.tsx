import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, formatMoney, formatPct } from './api';
import { DailyChart, MinuteChart } from './charts';

type Page = 'market' | 'stock' | 'sector' | 'select' | 'trading' | 'review' | 'sync';

function Change({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return <span>—</span>;
  }
  const number = Number(value);
  const className =
    number > 0 ? 'up' : number < 0 ? 'down' : '';

  return (
    <span className={className}>
      {formatPct(number)}
    </span>
  );
}

function StockTable({
  title,
  rows
}: {
  title: string;
  rows: any[];
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>现价</th>
            <th>涨跌</th>
            <th>成交额</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.price}</td>
              <td><Change value={row.pct} /></td>
              <td>{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SectorTable({
  title,
  rows
}: {
  title: string;
  rows: any[];
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {rows.length === 0 && (
        <div className="notice">暂无板块数据。请在数据同步页启用支持“板块”的数据源并同步；未启用时不会请求东方财富。</div>
      )}
      <table>
        <thead>
          <tr>
            <th>板块</th>
            <th>涨跌</th>
            <th>上涨</th>
            <th>下跌</th>
            <th>领涨股</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.type}-${row.code}`}>
              <td>{row.name}</td>
              <td><Change value={row.pct} /></td>
              <td>{row.upCount ?? row.up_count ?? '-'}</td>
              <td>{row.downCount ?? row.down_count ?? '-'}</td>
              <td>{row.leadStock ?? row.lead_stock ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MarketPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  const load = async (live = false) => {
    setError('');
    try {
      setData(
        await apiGet(
          '/market/overview?live=' + (live ? 'true' : 'false')
        )
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    // 默认读本地快照，避免打开首页就请求全市场东财实时接口。
    void load(false);
  }, []);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return <div className="notice">正在读取市场数据…</div>;
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>市场总览</h2>
          <p>指数、涨跌家数、活跃股票和板块强弱</p>
        </div>
        <button onClick={() => void load(true)}>刷新实时</button>
      </div>

      {data.degraded && (
        <div className="notice">
          部分数据暂不可用，已使用可获取的实时行情及本地历史数据。
          {(data.warnings || []).map((warning: string, i: number) => (
            <div key={i}>{warning}</div>
          ))}
        </div>
      )}

      <div className="index-grid">
        {data.indexes.map((item: any) => (
          <div className="card" key={item.code}>
            <span>{item.name}</span>
            <b>{item.quote?.price ?? '-'}</b>
            <Change value={item.quote?.pct} />
            <small>来源：{item.quote?.source || (item.quote ? 'DuckDB 本地' : '暂无数据')}</small>
          </div>
        ))}
      </div>

      <div className="stat-grid">
        <div className="card">
          <b>{data.breadth.up}</b>
          <span>上涨家数</span>
        </div>
        <div className="card">
          <b>{data.breadth.down}</b>
          <span>下跌家数</span>
        </div>
        <div className="card">
          <b>{data.breadth.up3}</b>
          <span>涨幅 ≥ 3%</span>
        </div>
        <div className="card">
          <b>{data.breadth.down3}</b>
          <span>跌幅 ≤ -3%</span>
        </div>
        <div className="card">
          <b>{formatMoney(data.breadth.amount)}</b>
          <span>市场成交额</span>
        </div>
      </div>

      <div className="two-column">
        <StockTable
          title="涨幅前十"
          rows={data.breadth.topGainers || []}
        />
        <StockTable
          title="成交额前十"
          rows={data.breadth.topAmount || []}
        />
      </div>

      <div className="two-column">
        <SectorTable
          title="行业板块前十"
          rows={data.sectors.industryTop || []}
        />
        <SectorTable
          title="概念板块前十"
          rows={data.sectors.conceptTop || []}
        />
      </div>
    </>
  );
}

function StockPage() {
  const [input, setInput] = useState('600186');
  const [data, setData] = useState<any>(null);
  const [searchRows, setSearchRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  const loadCode = async (code: string) => {
    setError('');
    setSearchRows([]);

    try {
      setData(await apiGet(`/ai/stock/${code}`));
      setInput(code);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const search = async () => {
    const value = input.trim();

    if (/^\d{6}$/.test(value)) {
      await loadCode(value);
      return;
    }

    setError('');
    try {
      const result = await apiGet<any>(
        `/stocks/search?q=${encodeURIComponent(value)}`
      );
      setSearchRows(result.data || []);
      if ((result.data || []).length === 0) {
        setError('没有找到匹配股票。名称搜索需要先完成一次“同步今日市场”。');
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void loadCode('600186');
  }, []);

  return (
    <>
      <div className="page-title">
        <div>
          <h2>股票查询</h2>
          <p>支持代码或名称搜索，查看实时行情、历史日 K、分钟数据和技术指标</p>
        </div>
      </div>

      <div className="search">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入代码或名称，例如 600186 / 莲花"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void search();
          }}
        />
        <button onClick={() => void search()}>搜索</button>
      </div>

      {searchRows.length > 0 && (
        <section className="panel search-result">
          <h3>搜索结果</h3>
          <table>
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>市场</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {searchRows.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td>{row.market_name}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => void loadCode(row.code)}
                    >
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {!data && !error && (
        <div className="notice">正在读取股票数据…</div>
      )}

      {data && (
        <>
          <div className="stock-head">
            <div>
              <span>{data.code}</span>
              <h2>
                {data.stock?.name ||
                  data.quote?.name ||
                  data.code}
              </h2>
            </div>
            <div>
              <b>{data.quote?.price ?? '-'}</b>
              <Change value={data.quote?.pct} />
            </div>
          </div>

          <div className="stat-grid">
            <div className="card">
              <b>{data.indicators?.ma5 ?? '-'}</b>
              <span>MA5</span>
            </div>
            <div className="card">
              <b>{data.indicators?.ma10 ?? '-'}</b>
              <span>MA10</span>
            </div>
            <div className="card">
              <b>{data.indicators?.ma20 ?? '-'}</b>
              <span>MA20</span>
            </div>
            <div className="card">
              <b>{formatPct(data.indicators?.return5)}</b>
              <span>5 日涨幅</span>
            </div>
            <div className="card">
              <b>{formatPct(data.indicators?.return20)}</b>
              <span>20 日涨幅</span>
            </div>
          </div>

          <section className="panel">
            <h3>历史日 K</h3>
            <DailyChart rows={data.daily || []} />
          </section>

          <section className="panel">
            <h3>1 分钟走势</h3>
            <MinuteChart rows={data.minute || []} />
          </section>
        </>
      )}
    </>
  );
}

function SectorPage() {
  const [industry, setIndustry] = useState<any[]>([]);
  const [concept, setConcept] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [a, b] = await Promise.all([
        apiGet<any>('/sectors?type=industry&live=true'),
        apiGet<any>('/sectors?type=concept&live=true')
      ]);

      setIndustry(a.data || []);
      setConcept(b.data || []);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <div className="page-title">
        <div>
          <h2>板块对比</h2>
          <p>行业板块和概念板块实时强弱</p>
        </div>
        <button onClick={() => void load()}>刷新</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="two-column">
        <SectorTable title="行业板块" rows={industry} />
        <SectorTable title="概念板块" rows={concept} />
      </div>
    </>
  );
}


function SelectPage() {
  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const load = async () => {
    setError('');
    try {
      const [latest, strategyConfig] = await Promise.all([
        apiGet<any>('/select/latest?limit=10'),
        apiGet<any>('/select/config')
      ]);
      setData(latest);
      setConfig(strategyConfig);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      await apiPost('/select/run');
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = data?.data || [];
  const mainRows = rows.filter((row: any) => row.isMain);

  return (
    <>
      <div className="page-title">
        <div>
          <h2>每日选股</h2>
          <p>收盘后按固定规则筛选，第二天只执行计划，不盘中临时改逻辑</p>
        </div>
        <button disabled={running} onClick={() => void run()}>
          {running ? '正在选股…' : '立即选股'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {!data?.run && !error && (
        <div className="notice">
          还没有选股记录。先完成历史日 K 初始化，再点击“立即选股”。
        </div>
      )}

      {data?.run && (
        <div className="notice">
          交易日 {String(data.run.trade_date).slice(0, 10)}，
          共扫描 {data.run.total} 只，选出 {data.run.passed} 只候选。
          当前策略：{data.run.strategy}
        </div>
      )}

      {mainRows.length > 0 && (
        <>
          <h3 className="section-title">明日重点 3 只</h3>
          <div className="select-grid">
            {mainRows.map((row: any) => (
              <section className="card select-card" key={row.code}>
                <div className="select-head">
                  <div>
                    <span className="rank">#{row.rank}</span>
                    <b>{row.name}</b>
                    <small>{row.code}</small>
                  </div>
                  <span className="tag">{row.setup}</span>
                </div>

                <div className="score">
                  <strong>{row.score}</strong>
                  <span>策略分</span>
                </div>

                <div className="plan-grid">
                  <div>
                    <span>参考收盘</span>
                    <b>{row.close}</b>
                  </div>
                  <div>
                    <span>买入区</span>
                    <b>{row.plan.entryLow} - {row.plan.entryHigh}</b>
                  </div>
                  <div>
                    <span>不追价</span>
                    <b>{row.plan.noChasePrice}</b>
                  </div>
                  <div>
                    <span>止损</span>
                    <b>{row.plan.stopPrice}</b>
                  </div>
                  <div>
                    <span>第一止盈</span>
                    <b>{row.plan.takeProfit1}</b>
                  </div>
                  <div>
                    <span>第二止盈</span>
                    <b>{row.plan.takeProfit2}</b>
                  </div>
                </div>

                <ul className="reason-list">
                  {row.reasons.map((reason: string) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {rows.length > 0 && (
        <section className="panel">
          <h3>全部候选</h3>
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>代码</th>
                <th>名称</th>
                <th>形态</th>
                <th>评分</th>
                <th>收盘</th>
                <th>5日涨幅</th>
                <th>量能</th>
                <th>止损</th>
                <th>第一止盈</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.code}>
                  <td>{row.rank}</td>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td>{row.setup}</td>
                  <td>{row.score}</td>
                  <td>{row.close}</td>
                  <td>{formatPct(row.return5)}</td>
                  <td>
                    {row.volumeRate5 == null
                      ? '-'
                      : row.volumeRate5.toFixed(2)}
                  </td>
                  <td>{row.plan.stopPrice}</td>
                  <td>{row.plan.takeProfit1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {config && (
        <section className="panel">
          <h3>当前执行纪律</h3>
          <div className="rule-grid">
            <div>
              <span>单票最大仓位</span>
              <b>{config.plan.maxPositionPct}%</b>
            </div>
            <div>
              <span>超过收盘涨幅不追</span>
              <b>{config.plan.noChasePct}%</b>
            </div>
            <div>
              <span>第一止盈</span>
              <b>{config.plan.firstTakeProfitPct}%</b>
            </div>
            <div>
              <span>移动止盈启动</span>
              <b>{config.plan.trailingStartPct}%</b>
            </div>
            <div>
              <span>高点回撤保护</span>
              <b>{config.plan.trailingDrawdownPct}%</b>
            </div>
            <div>
              <span>时间止损</span>
              <b>{config.plan.timeStopDays}个交易日</b>
            </div>
          </div>
        </section>
      )}
    </>
  );
}


function ReviewPage() {
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [backtest, setBacktest] = useState<any>(null);
  const [days, setDays] = useState(60);
  const [topCount, setTopCount] = useState(3);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [startingBacktest, setStartingBacktest] = useState(false);

  const load = async () => {
    setError('');
    try {
      const [a, b, c] = await Promise.all([
        apiGet<any>('/select/review/summary?mainOnly=true'),
        apiGet<any>('/select/review/latest?limit=50'),
        apiGet<any>('/select/backtests/latest')
      ]);
      setSummary(a);
      setRows(b.data || []);
      setBacktest(c);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (backtest?.run?.status !== 'running') return;

    const timer = window.setInterval(() => {
      void load();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [backtest?.run?.status]);

  const runReview = async () => {
    setReviewing(true);
    try {
      await apiPost('/select/review/run');
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setReviewing(false);
    }
  };

  const runBacktest = async () => {
    setStartingBacktest(true);
    try {
      await apiPost('/select/backtest', {
        tradeDays: days,
        topCount
      });
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setStartingBacktest(false);
    }
  };

  const defaultResult = backtest?.run?.default;
  const bestResult = backtest?.run?.best;

  return (
    <>
      <div className="page-title">
        <div>
          <h2>策略复盘</h2>
          <p>记录候选次日表现，用历史数据验证胜率、盈亏比和止盈止损参数</p>
        </div>
        <button disabled={reviewing} onClick={() => void runReview()}>
          {reviewing ? '正在复盘…' : '更新复盘'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {summary && (
        <div className="stat-grid review-stat-grid">
          <div className="card"><b>{summary.completed}</b><span>完成交易样本</span></div>
          <div className="card"><b>{formatPct(summary.entryRate)}</b><span>计划成交率</span></div>
          <div className="card"><b>{formatPct(summary.winRate)}</b><span>胜率</span></div>
          <div className="card"><b>{formatPct(summary.avgReturn)}</b><span>平均收益</span></div>
          <div className="card"><b>{summary.profitLossRatio ?? '-'}</b><span>盈亏比</span></div>
          <div className="card"><b>{formatPct(summary.maxDrawdown)}</b><span>样本最大回撤</span></div>
        </div>
      )}

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h3>参数回测</h3>
            <p>基于历史候选比较退出纪律。建议参数只展示，不会自动覆盖当前策略。</p>
          </div>
          <div className="backtest-actions">
            <label>
              交易日
              <input type="number" min={20} max={180} value={days}
                onChange={(event) => setDays(Number(event.target.value))} />
            </label>
            <label>
              每日前几名
              <input type="number" min={1} max={10} value={topCount}
                onChange={(event) => setTopCount(Number(event.target.value))} />
            </label>
            <button
              disabled={startingBacktest || backtest?.run?.status === 'running'}
              onClick={() => void runBacktest()}
            >
              {backtest?.run?.status === 'running'
                ? '回测运行中…'
                : startingBacktest ? '正在启动…' : '运行回测'}
            </button>
          </div>
        </div>

        {backtest?.run && (
          <div className="notice">
            状态：{backtest.run.status}；{backtest.run.message || ''}
            {backtest.run.start_date && (
              <span>
                ；区间 {String(backtest.run.start_date).slice(0, 10)}
                {' ~ '}
                {String(backtest.run.end_date).slice(0, 10)}
              </span>
            )}
          </div>
        )}

        {defaultResult && bestResult && (
          <div className="two-column">
            <div className="compare-card">
              <h4>当前参数</h4>
              <div className="compare-grid">
                <span>止损 <b>{defaultResult.params.stopPct}%</b></span>
                <span>目标 <b>{defaultResult.params.targetPct}%</b></span>
                <span>移动启动 <b>{defaultResult.params.trailingStartPct}%</b></span>
                <span>回撤退出 <b>{defaultResult.params.trailingDrawdownPct}%</b></span>
                <span>持有 <b>{defaultResult.params.holdDays}天</b></span>
                <span>胜率 <b>{formatPct(defaultResult.winRate)}</b></span>
                <span>均收益 <b>{formatPct(defaultResult.avgReturn)}</b></span>
                <span>盈亏比 <b>{defaultResult.profitLossRatio ?? '-'}</b></span>
              </div>
            </div>

            <div className="compare-card best">
              <h4>历史样本最优参数</h4>
              <div className="compare-grid">
                <span>止损 <b>{bestResult.params.stopPct}%</b></span>
                <span>目标 <b>{bestResult.params.targetPct}%</b></span>
                <span>移动启动 <b>{bestResult.params.trailingStartPct}%</b></span>
                <span>回撤退出 <b>{bestResult.params.trailingDrawdownPct}%</b></span>
                <span>持有 <b>{bestResult.params.holdDays}天</b></span>
                <span>胜率 <b>{formatPct(bestResult.winRate)}</b></span>
                <span>均收益 <b>{formatPct(bestResult.avgReturn)}</b></span>
                <span>盈亏比 <b>{bestResult.profitLossRatio ?? '-'}</b></span>
              </div>
              <small>仅为历史样本建议，不自动修改线上参数。</small>
            </div>
          </div>
        )}

        {(backtest?.parameters || []).length > 0 && (
          <table>
            <thead>
              <tr>
                <th>排名</th><th>止损</th><th>目标</th><th>移动启动</th>
                <th>回撤退出</th><th>持有</th><th>样本</th><th>胜率</th>
                <th>平均收益</th><th>盈亏比</th><th>最大回撤</th>
              </tr>
            </thead>
            <tbody>
              {backtest.parameters.slice(0, 10).map((row: any) => (
                <tr key={row.rank}>
                  <td>{row.rank}</td>
                  <td>{row.stop_pct}%</td>
                  <td>{row.target_pct}%</td>
                  <td>{row.trailing_start_pct}%</td>
                  <td>{row.trailing_drawdown_pct}%</td>
                  <td>{row.hold_days}天</td>
                  <td>{row.trades}</td>
                  <td>{formatPct(row.win_rate)}</td>
                  <td>{formatPct(row.avg_return)}</td>
                  <td>{row.profit_loss_ratio ?? '-'}</td>
                  <td>{formatPct(row.max_drawdown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {summary?.bySetup?.length > 0 && (
        <section className="panel">
          <h3>形态表现</h3>
          <table>
            <thead>
              <tr><th>形态</th><th>完成样本</th><th>胜率</th><th>平均收益</th></tr>
            </thead>
            <tbody>
              {summary.bySetup.map((row: any) => (
                <tr key={row.setup}>
                  <td>{row.setup}</td>
                  <td>{row.trades}</td>
                  <td>{formatPct(row.winRate)}</td>
                  <td>{formatPct(row.avgReturn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <h3>最近候选复盘</h3>
        {rows.length === 0 ? (
          <div className="notice">
            暂无可复盘数据。至少需要完成一次选股，并等待下一个交易日行情同步。
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>选股日</th><th>排名</th><th>代码</th><th>名称</th>
                <th>形态</th><th>状态</th><th>次日收盘</th><th>次日涨跌</th>
                <th>实际收益</th><th>最大浮盈</th><th>退出原因</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.run_id + '-' + row.code}>
                  <td>{String(row.select_date).slice(0, 10)}</td>
                  <td>{row.rank}</td>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td>{row.setup}</td>
                  <td>{row.status}</td>
                  <td>{row.next_close ?? '-'}</td>
                  <td>{formatPct(row.next_close_return_pct)}</td>
                  <td>{row.return_pct == null ? '-' : formatPct(row.return_pct)}</td>
                  <td>{row.max_profit_pct == null ? '-' : formatPct(row.max_profit_pct)}</td>
                  <td>{row.exit_reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}


function TradingPage() {
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [manualCode, setManualCode] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualQuantity, setManualQuantity] = useState('');
  const [manualDate, setManualDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA').format(new Date())
  );

  const stateText: Record<string, string> = {
    waiting: '等待',
    buy_ready: '可买',
    no_chase: '不追',
    invalid: '失效',
    holding: '持有',
    trailing: '移动止盈',
    t1_locked: 'T+1锁定',
    sell_ready: '可卖',
    closed: '已结束',
    expired: '已过期'
  };

  const signalText: Record<string, string> = {
    WAIT_NEXT_DAY: '等待次日',
    WAIT: '等待',
    WAIT_PULLBACK: '等回落',
    BUY: '买入条件',
    NO_CHASE: '不追高',
    INVALID: '候选失效',
    HOLD: '继续持有',
    TAKE_PROFIT_1: '第一止盈',
    TAKE_PROFIT_2: '第二止盈',
    TRAILING_ACTIVE: '移动止盈启动',
    TRAILING_STOP: '移动止盈退出',
    STOP_LOSS: '止损',
    TIME_EXIT: '时间退出',
    T1_LOCKED_RISK: 'T+1风险',
    CLOSED: '已卖出',
    EXPIRED: '计划过期'
  };

  const load = async () => {
    setError('');
    try {
      const [today, closed, eventRows] = await Promise.all([
        apiGet<any>('/trading/today'),
        apiGet<any>('/trading/history?limit=30'),
        apiGet<any>('/trading/events?limit=30')
      ]);

      setData(today);
      setHistory(closed.data || []);
      setEvents(eventRows.data || []);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await apiPost('/trading/refresh');
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setRefreshing(false);
    }
  };

  const buy = async (row: any) => {
    const value = window.prompt(
      '确认实际买入价',
      String(row.current_price || row.plan?.entryHigh || '')
    );
    if (!value) return;

    const quantity = window.prompt(
      '买入数量（股，可留空）',
      ''
    );

    try {
      await apiPost(
        '/trading/plans/' + encodeURIComponent(row.id) + '/buy',
        {
          price: Number(value),
          quantity: quantity ? Number(quantity) : undefined
        }
      );
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const sell = async (row: any) => {
    const value = window.prompt(
      '确认实际卖出价',
      String(row.current_price || row.exit_price || '')
    );
    if (!value) return;

    try {
      await apiPost(
        '/trading/plans/' + encodeURIComponent(row.id) + '/sell',
        {
          price: Number(value),
          reason: row.signal_reason || '手工确认卖出'
        }
      );
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const addPosition = async () => {
    if (!/^\d{6}$/.test(manualCode.trim())) {
      setError('请输入6位股票代码');
      return;
    }
    if (!(Number(manualPrice) > 0)) {
      setError('请输入正确的成本价');
      return;
    }

    try {
      await apiPost('/trading/positions', {
        code: manualCode.trim(),
        entryDate: manualDate,
        entryPrice: Number(manualPrice),
        quantity: manualQuantity
          ? Number(manualQuantity)
          : undefined
      });

      setManualCode('');
      setManualPrice('');
      setManualQuantity('');
      await load();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const rows = data?.plans || [];

  return (
    <>
      <div className="page-title">
        <div>
          <h2>盘中执行</h2>
          <p>昨晚定计划，盘中只看状态。系统不会自动下单，成交必须手工确认。</p>
        </div>
        <button disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? '正在刷新…' : '刷新行情'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {data && (
        <div className="stat-grid trading-stat-grid">
          <div className="card">
            <b>{data.counts?.buyReady || 0}</b>
            <span>进入买入区</span>
          </div>
          <div className="card">
            <b>{data.counts?.holding || 0}</b>
            <span>当前持仓</span>
          </div>
          <div className="card">
            <b>{data.counts?.sellReady || 0}</b>
            <span>卖出信号</span>
          </div>
          <div className="card">
            <b>{data.counts?.t1Locked || 0}</b>
            <span>T+1锁定风险</span>
          </div>
        </div>
      )}

      {(data?.actionable || []).length > 0 && (
        <section className="panel action-panel">
          <h3>需要处理</h3>
          <div className="action-list">
            {data.actionable.map((row: any) => (
              <div className="action-item" key={row.id}>
                <div>
                  <b>{row.name} {row.code}</b>
                  <span className={'trade-state state-' + row.state}>
                    {stateText[row.state] || row.state}
                  </span>
                </div>
                <p>{row.signal_reason}</p>
                <strong>{row.current_price ?? '-'}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>今日计划与持仓</h3>
        {rows.length === 0 ? (
          <div className="notice">
            暂无计划。收盘选股后会自动同步重点3只，也可以手工录入已有持仓。
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>股票</th>
                <th>状态</th>
                <th>信号</th>
                <th>现价</th>
                <th>买入区</th>
                <th>成本</th>
                <th>浮盈亏</th>
                <th>止损</th>
                <th>第一止盈</th>
                <th>移动保护</th>
                <th>说明</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.name}</b>
                    <br />
                    <small>{row.code}</small>
                  </td>
                  <td>
                    <span className={'trade-state state-' + row.state}>
                      {stateText[row.state] || row.state}
                    </span>
                  </td>
                  <td>{signalText[row.signal] || row.signal}</td>
                  <td>
                    {row.current_price ?? '-'}
                    <br />
                    <Change value={row.pct} />
                  </td>
                  <td>
                    {row.source === 'select'
                      ? String(row.plan?.entryLow ?? '-') + ' - ' +
                        String(row.plan?.entryHigh ?? '-')
                      : '-'}
                  </td>
                  <td>{row.entry_price ?? '-'}</td>
                  <td>
                    {row.unrealized_pct == null
                      ? '-'
                      : <Change value={row.unrealized_pct} />}
                  </td>
                  <td>{row.plan?.stopPrice ?? '-'}</td>
                  <td>{row.plan?.takeProfit1 ?? '-'}</td>
                  <td>{row.trailing_stop == null ? '-' : Number(row.trailing_stop).toFixed(2)}</td>
                  <td className="reason-cell">{row.signal_reason || '-'}</td>
                  <td>
                    {!row.entry_price && row.state === 'buy_ready' && (
                      <button
                        className="small-button"
                        onClick={() => void buy(row)}
                      >
                        确认买入
                      </button>
                    )}
                    {!row.entry_price && row.state !== 'buy_ready' && (
                      <span className="muted-text">按计划等待</span>
                    )}
                    {row.entry_price && row.state !== 'closed' && (
                      <button
                        className="small-button danger-button"
                        disabled={!row.can_sell}
                        onClick={() => void sell(row)}
                      >
                        {row.can_sell ? '确认卖出' : 'T+1锁定'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h3>录入已有持仓</h3>
        <div className="manual-position-form">
          <label>
            股票代码
            <input
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="600186"
            />
          </label>
          <label>
            买入日期
            <input
              type="date"
              value={manualDate}
              onChange={(event) => setManualDate(event.target.value)}
            />
          </label>
          <label>
            成本价
            <input
              type="number"
              step="0.01"
              value={manualPrice}
              onChange={(event) => setManualPrice(event.target.value)}
              placeholder="11.46"
            />
          </label>
          <label>
            数量
            <input
              type="number"
              step="100"
              value={manualQuantity}
              onChange={(event) => setManualQuantity(event.target.value)}
              placeholder="可留空"
            />
          </label>
          <button onClick={() => void addPosition()}>
            加入监控
          </button>
        </div>
        <p className="hint">
          手工持仓默认使用当前纪律：约3%止损、4%/6%两档止盈、4%启动移动止盈。
        </p>
      </section>

      {history.length > 0 && (
        <section className="panel">
          <h3>已结束交易</h3>
          <table>
            <thead>
              <tr>
                <th>股票</th><th>买入日</th><th>成本</th>
                <th>卖出日</th><th>卖出价</th><th>收益</th><th>原因</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row: any) => (
                <tr key={row.id}>
                  <td>{row.name} {row.code}</td>
                  <td>{String(row.entry_date || '').slice(0, 10)}</td>
                  <td>{row.entry_price}</td>
                  <td>{String(row.exit_date || '').slice(0, 10)}</td>
                  <td>{row.exit_price}</td>
                  <td><Change value={row.return_pct} /></td>
                  <td>{row.exit_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {events.length > 0 && (
        <section className="panel">
          <h3>最近状态变化</h3>
          <table>
            <thead>
              <tr>
                <th>时间</th><th>代码</th><th>事件</th>
                <th>状态</th><th>价格</th><th>说明</th>
              </tr>
            </thead>
            <tbody>
              {events.map((row: any) => (
                <tr key={row.id}>
                  <td>{String(row.market_time || row.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                  <td>{row.code}</td>
                  <td>{row.event_type}</td>
                  <td>{stateText[row.to_state] || row.to_state || '-'}</td>
                  <td>{row.price ?? '-'}</td>
                  <td>{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function SyncPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [days, setDays] = useState(120);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState('');
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [stopping, setStopping] = useState(false);
  const [saving, setSaving] = useState(false);

  const capabilityText: Record<string, string> = {
    snapshot: '全市场',
    daily: '日K',
    minute: '分钟K',
    sector: '板块',
    index: '指数',
    quote: '实时报价'
  };

  const sourceName = (id: string) =>
    sources.find((item) => item.id === id)?.name || id;

  const loadJobs = async () => {
    try {
      const result = await apiGet<any>('/sync/jobs?limit=30');
      setJobs(result.data || []);
    } catch {
      // 任务轮询失败时保留页面当前内容。
    }
  };

  const loadSources = async () => {
    const result = await apiGet<any>('/data-sources');
    setSources(result.data || []);
  };

  useEffect(() => {
    void Promise.all([loadJobs(), loadSources()]);

    const timer = window.setInterval(
      () => void loadJobs(),
      3000
    );

    return () => window.clearInterval(timer);
  }, []);

  const selectedSources = sources
    .filter((item) => item.enabled)
    .sort((a, b) => Number(a.priority) - Number(b.priority))
    .map((item) => item.id);

  const toggleSource = (id: string) => {
    setSources((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, enabled: !item.enabled }
          : item
      )
    );
  };

  const moveSource = (id: string, direction: -1 | 1) => {
    setSources((current) => {
      const ordered = [...current].sort(
        (a, b) => Number(a.priority) - Number(b.priority)
      );
      const index = ordered.findIndex((item) => item.id === id);
      const target = index + direction;

      if (index < 0 || target < 0 || target >= ordered.length) {
        return current;
      }

      const currentItem = ordered[index];
      ordered[index] = ordered[target];
      ordered[target] = currentItem;

      return ordered.map((item, order) => ({
        ...item,
        priority: (order + 1) * 10
      }));
    });
  };

  const saveSources = async () => {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const ordered = [...sources].sort(
        (a, b) => Number(a.priority) - Number(b.priority)
      );

      const result = await apiPut<any>('/data-sources', {
        sources: ordered.map((item, index) => ({
          id: item.id,
          enabled: !!item.enabled,
          priority: (index + 1) * 10
        }))
      });

      setSources(result.data || []);
      setMessage('数据源选择和优先级已保存');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSaving(false);
    }
  };

  const testOneSource = async (
    id: string,
    capability: string
  ) => {
    const key = id + ':' + capability;
    setTesting(key);
    setError('');
    setMessage('');

    try {
      const result = await apiPost<any>('/data-sources/test', {
        source: id,
        capability
      });

      setTestResults((current) => ({
        ...current,
        [key]: {
          success: true,
          ...result
        }
      }));

      setMessage(
        result.sourceName +
          ' / ' +
          (capabilityText[result.capability] || result.capability) +
          ' 测试成功，延迟 ' +
          result.latencyMs +
          'ms'
      );
      await loadSources();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      setTestResults((current) => ({
        ...current,
        [key]: {
          success: false,
          message
        }
      }));

      setError(message);
      await loadSources();
    } finally {
      setTesting('');
    }
  };

  const start = async (
    path: string,
    body: Record<string, unknown> = {}
  ) => {
    if (selectedSources.length === 0) {
      setError('请至少勾选一个数据源');
      return;
    }

    setError('');
    setMessage('');

    try {
      await saveSources();
      await apiPost(path, {
        ...body,
        sources: selectedSources
      });

      setMessage(
        '任务已提交，数据源顺序：' +
          selectedSources.map(sourceName).join(' → ')
      );
      await loadJobs();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const stopAll = async () => {
    setStopping(true);
    setError('');
    setMessage('');

    try {
      const result = await apiPost<any>('/sync/stop-all');
      setMessage(
        '已发送停止指令，取消 ' +
          String(result.stopped || 0) +
          ' 个排队或运行任务'
      );
      await loadJobs();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setStopping(false);
    }
  };

  const orderedSources = [...sources].sort(
    (a, b) => Number(a.priority) - Number(b.priority)
  );

  return (
    <>
      <div className="page-title">
        <div>
          <h2>数据同步</h2>
          <p>测试数据源、选择同步源、调整优先级，并管理同步任务</p>
        </div>
        <button
          className="stop-all-button"
          disabled={stopping}
          onClick={() => void stopAll()}
        >
          {stopping ? '正在停止…' : '停止全部同步'}
        </button>
      </div>

      {message && <div className="notice">{message}</div>}
      {error && <div className="error">{error}</div>}

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h3>数据源管理</h3>
              <p><a href="/bridge.html" target="_blank" rel="noopener noreferrer">外部行情桥接：在可访问东财的电脑上采集并推送数据 →</a></p>
            <p>
              数据源按能力过滤后从上到下依次尝试；例如新浪支持全市场快照，腾讯支持日K、分钟K和指数。禁用的数据源不会参与业务请求。
            </p>
          </div>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => void saveSources()}
          >
            {saving ? '正在保存…' : '保存数据源设置'}
          </button>
        </div>

        <div className="source-list">
          {orderedSources.map((source, index) => (
            <div
              className={
                'source-card ' +
                (!source.available ? 'source-unavailable' : '')
              }
              key={source.id}
            >
              <div className="source-order">
                <b>{index + 1}</b>
                <div>
                  <button
                    title="上移"
                    disabled={index === 0}
                    onClick={() => moveSource(source.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    title="下移"
                    disabled={index === orderedSources.length - 1}
                    onClick={() => moveSource(source.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>

              <label className="source-check">
                <input
                  type="checkbox"
                  checked={!!source.enabled}
                  disabled={!source.available}
                  onChange={() => toggleSource(source.id)}
                />
                <span>
                  <b>{source.name}</b>
                  <small>{source.id}</small>
                </span>
              </label>

              <div className="source-description">
                <p>{source.description}</p>
                <div className="source-tags">
                  {(source.capabilities || []).map(
                    (capability: string) => (
                      <span key={capability}>
                        {capabilityText[capability] || capability}
                      </span>
                    )
                  )}
                  <span>
                    {source.independent ? '独立源' : '东财系'}
                  </span>
                  {source.needsToken && <span>需要 Token</span>}
                </div>
              </div>

              <div className="source-status">
                {!source.available ? (
                  <span className="status-bad">未配置 Token</span>
                ) : source.status?.lastStatus === 'success' ? (
                  <>
                    <span className="status-good">最近成功</span>
                    <small>
                      {source.status.lastLatencyMs == null
                        ? ''
                        : String(Math.round(source.status.lastLatencyMs)) +
                          'ms'}
                    </small>
                  </>
                ) : source.status?.lastStatus ? (
                  <>
                    <span className="status-bad">
                      {source.status.lastStatus}
                    </span>
                    <small>{source.status.lastMessage}</small>
                  </>
                ) : (
                  <span className="muted-text">尚未测试</span>
                )}
              </div>

              <div className="source-test-area">
                <div className="source-test-actions">
                  {(source.capabilities || []).map(
                    (capability: string) => {
                      const key = source.id + ':' + capability;
                      return (
                        <button
                          className="source-test-button"
                          key={capability}
                          disabled={
                            !source.available || testing === key
                          }
                          onClick={() =>
                            void testOneSource(
                              source.id,
                              capability
                            )
                          }
                        >
                          {testing === key
                            ? '测试中…'
                            : '测' +
                              (capabilityText[capability] || capability)}
                        </button>
                      );
                    }
                  )}
                </div>

                {(source.capabilities || []).map(
                  (capability: string) => {
                    const key = source.id + ':' + capability;
                    const result = testResults[key];
                    if (!result) return null;

                    return (
                      <div
                        className={
                          'source-test-result ' +
                          (result.success
                            ? 'test-success'
                            : 'test-failed')
                        }
                        key={key}
                      >
                        <b>
                          {capabilityText[capability] || capability}
                        </b>
                        <span>
                          {result.success
                            ? String(result.latencyMs) +
                              'ms / ' +
                              String(result.count) +
                              '条'
                            : result.message}
                        </span>
                        {result.success && (
                          <pre>
                            {JSON.stringify(
                              result.sample,
                              null,
                              2
                            )}
                          </pre>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="source-chain">
          <b>当前同步顺序：</b>
          {selectedSources.length > 0
            ? selectedSources.map(sourceName).join(' → ')
            : '未选择数据源'}
        </div>
      </section>

      <div className="action-grid">
        <div className="card action-card">
          <h3>同步今日市场</h3>
          <p>
            使用支持“全市场”的已选数据源，按优先级自动降级并写入 DuckDB。
          </p>
          <button onClick={() => void start('/sync/daily')}>
            开始同步
          </button>
        </div>

        <div className="card action-card">
          <h3>同步板块</h3>
          <p>
            自动从已选数据源中筛出支持板块的来源；当前东财行情提供完整行业/概念板块。
          </p>
          <button onClick={() => void start('/sync/sectors')}>
            开始同步
          </button>
        </div>

        <div className="card action-card">
          <h3>初始化历史日 K</h3>
          <p>
            每只股票都按已选来源顺序尝试，例如腾讯 → 东财历史 → Tushare。
          </p>
          <div className="row">
            <input
              type="number"
              min={20}
              max={1000}
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value))
              }
            />
            <button
              onClick={() =>
                void start('/sync/history', { days })
              }
            >
              开始初始化
            </button>
          </div>
        </div>
      </div>

      <section className="panel">
        <h3>任务记录</h3>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>状态</th>
              <th>进度</th>
              <th>数据源执行情况</th>
              <th>说明</th>
              <th>开始时间</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.job_type}</td>
                <td>
                  <span className={'job-status job-' + job.status}>
                    {job.status}
                  </span>
                </td>
                <td>{job.done}/{job.total}</td>
                <td className="source-job-cell">
                  {(job.sources || []).length === 0
                    ? '-'
                    : job.sources.map((source: any) => (
                        <span
                          className={
                            'source-job source-job-' + source.status
                          }
                          key={source.source_id}
                          title={source.message || ''}
                        >
                          {sourceName(source.source_id)}：{source.status}
                        </span>
                      ))}
                </td>
                <td className="reason-cell">{job.message}</td>
                <td>
                  {String(job.started_at || '')
                    .replace('T', ' ')
                    .slice(0, 19)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}


export default function App() {
  const [page, setPage] = useState<Page>('market');

  const menu: Array<[Page, string]> = [
    ['market', '市场总览'],
    ['stock', '股票查询'],
    ['sector', '板块对比'],
    ['select', '每日选股'],
    ['trading', '盘中执行'],
    ['review', '策略复盘'],
    ['sync', '数据同步']
  ];

  return (
    <div className="layout">
      <aside>
        <div className="brand">
          <b>Quant</b>
          <span>本地行情平台</span>
        </div>

        <nav>
          {menu.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => setPage(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        {page === 'market' && <MarketPage />}
        {page === 'stock' && <StockPage />}
        {page === 'sector' && <SectorPage />}
        {page === 'select' && <SelectPage />}
        {page === 'trading' && <TradingPage />}
        {page === 'review' && <ReviewPage />}
        {page === 'sync' && <SyncPage />}
      </main>
    </div>
  );
}
