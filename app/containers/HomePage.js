// @flow
import path from 'path';
import React, { Component } from 'react';
import { ResizableBox } from 'react-resizable';
import { ipcRenderer } from 'electron';
import { Switch, Route } from 'react-router';
import {
  Tabs,
  Tab,
  TabPanel,
  TabList,
  HTMLTabs
} from '@falcon-client/falcon-ui';
import Loadable from 'react-loadable';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { OPEN_FILE_CHANNEL } from '../types/channels';
import type { TableType } from '../types/TableType';

// @NOTE: This duplication is necessary. It makes webpack lazily load the chunks
const ContentPage = Loadable({
  loader: () => import('./ContentPage').then(o => o.default),
  loading: () => <div>Loading...</div>
});
const LoginPage = Loadable({
  loader: () => import('./LoginPage').then(o => o.default),
  loading: () => <div>Loading...</div>
});
const StructurePage = Loadable({
  loader: () => import('./StructurePage').then(o => o.default),
  loading: () => <div>Loading...</div>
});
const QueryPage = Loadable({
  loader: () => import('./QueryPage').then(o => o.default),
  loading: () => <div>Loading...</div>
});
const GraphPage = Loadable({
  loader: () => import('./GraphPage').then(o => o.default),
  loading: () => <div>Loading...</div>
});
const LogPage = Loadable({
  loader: () => import('./LogPage').then(o => o.default),
  loading: () => <div>Loading...</div>
});

type Props = {
  location: {
    pathname: string
  }
};

type State = {
  widthSidebar: number, // 200
  widthGrid: number, // window.innerWidth - 200
  databaseName: ?string,
  selectedTabIndex: number,
  selectedTable: ?TableType,
  selectedConnection: ?connectionType,
  tableColumns: Array<TableColumnType>,
  tableDefinition: string,
  activeConnections: Array<connectionType>,
  connections: Array<connectionType>,
  isLoading: boolean,
  logs: Array<{ query: string, time: string, duration: string }>,
  tables: Array<{
    name: string
  }>
};

export default class HomePage extends Component<Props, State> {
  core: Database;

  sqlFormatter: ((sql: string, numSpaces: number) => string) | (() => {});

  state = {
    // @TODO: See LoginPage line 131 for why replace'_' with '/'
    widthSidebar: 200,
    widthGrid: window.innerWidth - 200,
    databaseName: null,
    tables: [],
    // @HACK: HARDCODE
    databaseType: 'SQLite',
    databaseVersion: '',
    selectedTabIndex: 0,
    selectedTable: null,
    selectedConnection: null,
    tableColumns: [],
    tableDefinition: '',
    rows: [],
    logs: [],
    activeConnections: [],
    connections: [],
    isLoading: true,
    sqlFormatter: () => {}
  };

  ipcConnection = null;

  refreshQueryFn = () => {};

  constructor(props: Props) {
    super(props);
    ipcRenderer.on(OPEN_FILE_CHANNEL, (event, filePath) => {
      this.ipcConnection = {
        database: filePath
      };
    });
    // ipcRenderer.on(DELETE_TABLE_CHANNEL, () => {
    //   this.deleteSelectedTable();
    // });
  }

  /**
   * Uses the database api to set container's state from falcon-core
   * @TODO: Since supporting just SQLite, getDatabases will only return 1 db
   */
  getInitialViewData = async () => {
    const [databases, tableNames, databaseVersion, logs] = await Promise.all([
      this.core.connection.listDatabases(),
      this.core.connection.listTables(),
      this.core.connection.getVersion(),
      this.core.connection.getLogs()
    ]);
    if (tableNames.length === 0) {
      return;
    }
    const selectedTable = this.state.selectedTable || {
      name: tableNames[0].name
    };
    const databaseName = path.parse(databases[0]).base;

    await this.onTableSelect(selectedTable);

    this.getLogsInterval = setInterval(() => {
      this.core.connection.getLogs().then(logs => {
        this.setState({
          logs
        });
      });
    }, 5000);

    this.setState({
      databaseName,
      selectedTable,
      logs,
      databaseVersion,
      isLoading: false,
      tables: tableNames
      // @TODO: Use tableName instead of whole table object contents
      // databasePath: filePath
    });
  };

  /**
   * Allow child components of HomePage to define fn's that are called onclick
   * of the refresh button in the Header
   */
  setRefreshQueryFn(refreshQueryFn) {
    this.refreshQueryFn = refreshQueryFn;
  }

  /**
   * Call the fn defined in setRefreshQueryFn()
   */
  async callRefreshQueryFn() {
    this.setState({
      isLoading: true
    });
    await this.refreshQueryFn();
    this.setState({
      isLoading: false
    });
  }

  async setConnections() {
    const connections = await this.connectionManager.getAll();
    this.setState({
      connections
    });
    // @HACK
    if (connections.length) {
      await this.onConnectionSelect(connections[0]);
    }
    return connections;
  }

  async executeQuery(query: string) {
    return this.core.connection.executeQuery(query);
  }

  onResizeGrid = (event, { size }) => {
    this.setState({
      widthGrid: size.width,
      widthSidebar: window.innerWidth - size.width
    });
  };

  onResizeSidebar = (event, { size }) => {
    this.setState({
      widthSidebar: size.width,
      widthGrid: window.innerWidth - size.width
    });
  };

  onConnectionSelect = async (selectedConnection: connectionType) => {
    const a = await import('falcon-core/es/database/provider_clients/SqliteProviderFactory');
    const { default: SqliteProviderFactory } = a;

    this.core.connection = await SqliteProviderFactory(
      selectedConnection,
      selectedConnection
    );
    this.state.selectedTable = undefined;
    await this.getInitialViewData();
    this.setState({
      selectedConnection
    });
  };

  onTableSelect = async (selectedTable: TableType) => {
    // Redefine the refresh query to the select table
    this.setRefreshQueryFn(() => {
      this.setState({
        rows: []
      });
      this.onTableSelect(selectedTable);
    });

    this.setState({
      selectedTable,
      isLoading: true
    });

    const [tableDefinition, tableColumns, tableValues] = await Promise.all([
      this.core.connection.getTableCreateScript(selectedTable.name),
      this.core.connection.getTableColumns(selectedTable.name),
      this.core.connection.getTableValues(selectedTable.name)
    ]);

    // @HACK: This should be abstracted to falcon-core
    const rows = tableValues.map((value, index) => ({
      rowID: value[Object.keys(value)[index]],
      value: Object.values(value).filter(e => !(e instanceof Buffer))
    }));

    this.setState({
      tableColumns,
      rows,
      isLoading: false,
      tableDefinition: tableDefinition[0]
      // @TODO: Use tableName instead of whole table object contents
      // databasePath: filePath
    });
  };

  onTabSelect = (index: number, event: SyntheticEvent) => {
    this.setState({ selectedTabIndex: index });
  };

  /**
   * Upon mounting, component fetches initial database data and configures
   * grid/sidebar resizing data. Also core
   */
  async componentDidMount() {
    const [a, b, c] = await Promise.all([
      import('falcon-core/es/database/provider_clients/SqliteProviderFactory'),
      import('falcon-core/es/config/ConnectionManager'),
      import('falcon-core/es/formatters/SqliteFormatter')
    ]);

    const { default: SqliteProviderFactory } = a;
    const { default: ConnectionManager } = b;
    const { default: SqliteFormatter } = c;

    // @HACK: This is a temporary way if improving require performance.
    //        The API itself in falcon-core needs to be changed to reflect this
    this.core = {};
    this.connectionManager = new ConnectionManager();
    this.sqlFormatter = SqliteFormatter;
    this.setConnections()
      .then(async connections => {
        if (connections.length) {
          // @HACK: Temporarily connect to the first conenction in the connections
          //        array
          this.core.connection = await SqliteProviderFactory(
            this.ipcConnection || connections[0],
            this.ipcConnection || connections[0]
          );
          await this.getInitialViewData();
          if (
            this.props.history.location.pathname === '/login' ||
            this.props.history.location.pathname === '/'
          ) {
            this.props.history.push('/content');
          }
        } else {
          this.props.history.push('/login');
        }
        return connections;
      })
      .catch(console.log);

    // View/DOM related logic
    window.onresizeFunctions['sidebar-resize-set-state'] = () => {
      this.setState({
        widthSidebar: this.state.widthSidebar,
        widthGrid: window.innerWidth - this.state.widthSidebar
      });
    };
    const grid = document.querySelector('.HomePage .Grid');
    const sidebar = document.querySelector('.Sidebar');
    if (grid && sidebar) {
      const height = 32 + 10 + 21 + 15;
      // -32 for Tabs Height
      grid.style.height = `${window.innerHeight - height - 32}px`;
      sidebar.style.height = `${window.innerHeight - height + 40}px`;
      // If the window is resized, change the height of the grid repsectively
      window.onresizeFunctions['resize-grid-resize'] = () => {
        grid.style.height = `${window.innerHeight - height - 32}px`;
        sidebar.style.height = `${window.innerHeight - height + 40}px`;
      };
    }
    // Preload other pages when the browser's main thread isn't busy
    requestIdleCallback(() => {
      ContentPage.preload();
      StructurePage.preload();
      QueryPage.preload();
      GraphPage.preload();
      LogPage.preload();
    });
  }

  componentWillUnmount() {
    clearInterval(this.getLogsInterval);
  }

  render() {
    return (
      <div className="HomePage container-fluid">
        <div className="row">
          <div className="sticky">
            <Header
              history={this.props.history}
              isLoading={this.state.isLoading}
              selectedTable={this.state.selectedTable}
              databaseType={this.state.databaseType}
              databaseName={this.state.databaseName}
              databaseVersion={this.state.databaseVersion}
              onRefreshClick={() => this.callRefreshQueryFn()}
            />
            <div className="row no-margin">
              <ResizableBox
                width={this.state.widthSidebar}
                height={100}
                minConstraints={[100, 200]}
                maxConstraints={[400, 400]}
                onResize={this.onResizeSidebar}
                handleSize={[100, 100]}
                axis="x"
              >
                {/* Currently only supports one database file at a time (since using SQLite only) */}
                <Sidebar
                  pathname={this.props.location.pathname}
                  databaseName={this.state.databaseName}
                  tables={this.state.tables}
                  onTableSelect={this.onTableSelect}
                  onConnectionSelect={this.onConnectionSelect}
                  selectedTable={this.state.selectedTable}
                  selectedConnection={this.state.selectedConnection}
                  connections={this.state.connections}
                  activeConnections={this.state.activeConnections}
                />
              </ResizableBox>
              <div>
                <Tabs
                  width={this.state.widthGrid}
                  selectedIndex={this.state.selectedTabIndex}
                  onSelect={this.onTabSelect}
                >
                  <TabList
                    clientWidth={this.state.widthGrid}
                    minTabWidth={45}
                    maxTabWidth={243}
                    tabOverlapDistance={0}
                  >
                    <Tab title="falcon-ui" />
                    <Tab title="compat-db" />
                  </TabList>
                </Tabs>
                <div
                  className="Grid"
                  style={{
                    position: 'relative',
                    width: this.state.widthGrid
                  }}
                >
                  <Switch>
                    <Route
                      exact
                      strict
                      path="/login"
                      render={() => (
                        <LoginPage
                          connectionManager={this.connectionManager}
                          onSuccess={() => {
                            this.setConnections();
                            this.props.history.push('/content');
                          }}
                        />
                      )}
                    />
                    <Route
                      exact
                      strict
                      path="/content"
                      render={() =>
                        this.state.selectedTable ? (
                          <ContentPage
                            table={{
                              name: this.state.selectedTable.name,
                              columns: this.state.tableColumns,
                              rows: this.state.rows
                            }}
                          />
                        ) : null
                      }
                    />
                    <Route
                      exact
                      strict
                      path="/structure"
                      render={() => (
                        <StructurePage
                          tableColumns={this.state.tableColumns}
                          tableDefinition={this.state.tableDefinition}
                          setRefreshQueryFn={() =>
                            this.setRefreshQueryFn(() =>
                              this.onTableSelect(this.state.selectedTable)
                            )
                          }
                        />
                      )}
                    />
                    <Route
                      exact
                      strict
                      path="/query"
                      render={() => (
                        <QueryPage
                          tableColumns={this.state.tableColumns}
                          setRefreshQueryFn={e => this.setRefreshQueryFn(e)}
                          executeQuery={query => this.executeQuery(query)}
                          sqlFormatter={this.sqlFormatter}
                        />
                      )}
                    />
                    <Route
                      exact
                      strict
                      path="/graph"
                      render={() =>
                        this.core &&
                        this.core.connection &&
                        this.state.selectedConnection &&
                        this.state.selectedConnection.database ? (
                          <GraphPage
                            databasePath={
                              this.state.selectedConnection.database
                            }
                            connection={this.core.connection}
                          />
                        ) : null
                      }
                    />
                    <Route
                      exact
                      strict
                      path="/logs"
                      render={() => <LogPage logs={this.state.logs} />}
                    />
                  </Switch>
                </div>
              </div>
              <Footer
                offset={this.state.widthSidebar}
                pathname={this.props.location.pathname}
                history={this.props.history}
                hasActiveConnection={
                  this.state.activeConnections.length !== 0 ||
                  this.state.connections.length !== 0
                }
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
}
