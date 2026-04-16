## matslop_export_fig(h)
##
## Serialize an Octave figure handle `h` to a JSON string matching the
## schema defined in src/main/plotSchema.ts (MatSlop plot schema v1).
##
## The emitted JSON is consumed by a JavaScript plot renderer (Plotly.js)
## so that figures rendered by Octave can be re-drawn interactively inside
## the MatSlop IDE. See US-007 in the roadmap.
##
## Usage:
##   json = matslop_export_fig(gcf());
##   disp(['__MATSLOP_FIG_JSON__:' json]);
##
## Supported plot types (others are surfaced as {"type":"unknown"}):
##   plot, plot3, scatter, scatter3, surf, mesh,
##   quiver, quiver3, bar, bar3, contour, contour3, imagesc
##
## The function deliberately avoids optional Octave packages — it only uses
## core handle-graphics introspection (`get`) so it works out of the box
## against the bundled Octave distribution.

function json = matslop_export_fig(h)
  if nargin < 1
    h = gcf();
  endif
  fig = struct();
  fig.schemaVersion = 1;
  fig.handle = double(h);
  try
    nm = get(h, "name");
    if ischar(nm) && ~isempty(nm)
      fig.name = nm;
    endif
  catch
  end_try_catch
  try
    bg = get(h, "color");
    fig.backgroundColor = num2cell(double(bg(:)'));
  catch
  end_try_catch
  try
    pos = get(h, "position");
    fig.size = {double(pos(3)), double(pos(4))};
  catch
  end_try_catch

  ## Capture the figure's colormap as an array of [position, r, g, b] stops
  ## for conversion to a Plotly colorscale.
  try
    cmap = get(h, "colormap");
    if ~isempty(cmap)
      n = rows(cmap);
      stops = cell(1, n);
      for ci = 1:n
        pos = (ci - 1) / max(n - 1, 1);
        stops{ci} = {pos, num2cell(double(cmap(ci, :)))};
      endfor
      fig.colormap = stops;
    endif
  catch
  end_try_catch

  fig.axes = {};
  try
    ax_handles = findall(h, "type", "axes");
  catch
    ax_handles = [];
  end_try_catch
  ## Detect colorbar axes so we can skip them and flag the plot axes.
  has_colorbar = false;
  for ii = 1:numel(ax_handles)
    try
      tag = get(ax_handles(ii), "tag");
      if strcmp(tag, "colorbar")
        has_colorbar = true;
      endif
    catch
    end_try_catch
  endfor
  for ii = 1:numel(ax_handles)
    ax = ax_handles(ii);
    ## Skip legend and colorbar axes — they are handled specially.
    try
      tag = get(ax, "tag");
      if strcmp(tag, "legend") || strcmp(tag, "colorbar")
        continue;
      endif
    catch
    end_try_catch
    s = __matslop_axes_to_struct__(ax);
    if has_colorbar
      s.colorbar = true;
    endif
    fig.axes{end+1} = s;
  endfor

  json = __matslop_to_json__(fig);
endfunction

function s = __matslop_axes_to_struct__(ax)
  s = struct();
  try; s.title  = __matslop_label_string__(get(ax, "title"));  catch; end_try_catch
  try; s.xLabel = __matslop_label_string__(get(ax, "xlabel")); catch; end_try_catch
  try; s.yLabel = __matslop_label_string__(get(ax, "ylabel")); catch; end_try_catch
  try; s.zLabel = __matslop_label_string__(get(ax, "zlabel")); catch; end_try_catch
  try; s.xLimits = num2cell(double(get(ax, "xlim"))); catch; end_try_catch
  try; s.yLimits = num2cell(double(get(ax, "ylim"))); catch; end_try_catch
  try; s.zLimits = num2cell(double(get(ax, "zlim"))); catch; end_try_catch
  try; s.xScale  = get(ax, "xscale"); catch; end_try_catch
  try; s.yScale  = get(ax, "yscale"); catch; end_try_catch
  try; s.zScale  = get(ax, "zscale"); catch; end_try_catch
  try; s.view    = num2cell(double(get(ax, "view"))); catch; end_try_catch
  try
    s.grid = strcmp(get(ax, "xgrid"), "on") || strcmp(get(ax, "ygrid"), "on");
  catch
  end_try_catch
  try; s.box    = strcmp(get(ax, "box"), "on"); catch; end_try_catch
  try; s.position = num2cell(double(get(ax, "position"))); catch; end_try_catch
  try; s.backgroundColor = num2cell(double(get(ax, "color"))); catch; end_try_catch

  s.series = {};
  try
    kids = get(ax, "children");
  catch
    kids = [];
  end_try_catch
  ## Iterate in reverse so the Octave drawing order (last added on top)
  ## matches a human reading left-to-right / bottom-to-top in the output.
  for jj = numel(kids):-1:1
    ser = __matslop_series_to_struct__(kids(jj));
    if ~isempty(ser)
      s.series{end+1} = ser;
    endif
  endfor
endfunction

function out = __matslop_label_string__(labelHandle)
  out = "";
  try
    out = get(labelHandle, "string");
  catch
  end_try_catch
  if iscell(out)
    out = strjoin(out, "\n");
  endif
endfunction

function ser = __matslop_series_to_struct__(k)
  ser = struct();
  tp = "";
  try
    tp = get(k, "type");
  catch
    ser = [];
    return;
  end_try_catch
  switch tp
    case "line"
      xd = double(get(k, "xdata"));
      yd = double(get(k, "ydata"));
      zd = [];
      try
        zd = double(get(k, "zdata"));
      catch
      end_try_catch
      ls = "-";
      try; ls = get(k, "linestyle"); catch; end_try_catch
      mk = "none";
      try; mk = get(k, "marker"); catch; end_try_catch
      if ~isempty(zd)
        ser.type = "line3";
        ser.x = num2cell(xd(:)');
        ser.y = num2cell(yd(:)');
        ser.z = num2cell(zd(:)');
      else
        ## Distinguish scatter (marker only, no line) from line.
        if strcmp(ls, "none") && ~strcmp(mk, "none")
          ser.type = "scatter";
        else
          ser.type = "line";
        endif
        ser.x = num2cell(xd(:)');
        ser.y = num2cell(yd(:)');
      endif
      try; ser.color = num2cell(double(get(k, "color"))); catch; end_try_catch
      ser.lineStyle = ls;
      try; ser.lineWidth = double(get(k, "linewidth")); catch; end_try_catch
      ser.marker = mk;
      try; ser.markerSize = double(get(k, "markersize")); catch; end_try_catch
      try; ser.label = get(k, "displayname"); catch; end_try_catch
    case "surface"
      xd = double(get(k, "xdata"));
      yd = double(get(k, "ydata"));
      zd = double(get(k, "zdata"));
      ec = "none";
      try; ec = get(k, "edgecolor"); catch; end_try_catch
      fc = "none";
      try; fc = get(k, "facecolor"); catch; end_try_catch
      if ischar(fc) && strcmp(fc, "none") && ischar(ec) && ~strcmp(ec, "none")
        ser.type = "mesh";
      else
        ser.type = "surface";
      endif
      ser.x = __matslop_mat_to_cell__(xd);
      ser.y = __matslop_mat_to_cell__(yd);
      ser.z = __matslop_mat_to_cell__(zd);
      if ischar(ec)
        ser.edgeColor = ec;
      else
        ser.edgeColor = num2cell(double(ec));
      endif
      if ischar(fc)
        ser.faceColor = fc;
      else
        ser.faceColor = num2cell(double(fc));
      endif
      ## Capture color data for shading interp support
      try
        cd = double(get(k, "cdata"));
        if ~isempty(cd)
          ser.c = __matslop_mat_to_cell__(cd);
        endif
      catch
      end_try_catch
      ## facelighting for surfl
      try
        fl = get(k, "facelighting");
        if ischar(fl) && ~strcmp(fl, "none")
          ser.faceLighting = fl;
        endif
      catch
      end_try_catch
    case "patch"
      ## contour creates patches; best-effort.
      ser.type = "contour";
      try; ser.x = __matslop_mat_to_cell__(double(get(k, "xdata"))); catch; end_try_catch
      try; ser.y = __matslop_mat_to_cell__(double(get(k, "ydata"))); catch; end_try_catch
      try; ser.z = __matslop_mat_to_cell__(double(get(k, "zdata"))); catch; end_try_catch
    case "hggroup"
      ## Vector fields (quiver), bar groups, scatter groups are hggroups.
      tag = "";
      try; tag = get(k, "tag"); catch; end_try_catch
      if ~isempty(strfind(lower(tag), "quiver"))
        ser.type = "quiver";
        try
          ser.x = num2cell(double(get(k, "xdata"))(:)');
          ser.y = num2cell(double(get(k, "ydata"))(:)');
          ser.u = num2cell(double(get(k, "udata"))(:)');
          ser.v = num2cell(double(get(k, "vdata"))(:)');
          try
            zd = double(get(k, "zdata"));
            wd = double(get(k, "wdata"));
            ser.z = num2cell(zd(:)');
            ser.w = num2cell(wd(:)');
            ser.type = "quiver3";
          catch
          end_try_catch
        catch
        end_try_catch
      elseif ~isempty(strfind(lower(tag), "bar"))
        ser.type = "bar";
        try
          ser.x = num2cell(double(get(k, "xdata"))(:)');
          ser.y = num2cell(double(get(k, "ydata"))(:)');
        catch
        end_try_catch
      else
        ser.type = "unknown";
        ser.octaveType = tp;
      endif
    case "image"
      ser.type = "image";
      try
        xd = double(get(k, "xdata"));
        yd = double(get(k, "ydata"));
        ser.xLimits = {xd(1), xd(end)};
        ser.yLimits = {yd(1), yd(end)};
      catch
      end_try_catch
      try
        ser.data = __matslop_mat_to_cell__(double(get(k, "cdata")));
      catch
      end_try_catch
    otherwise
      ser.type = "unknown";
      ser.octaveType = tp;
  endswitch
  try
    dn = get(k, "displayname");
    if ~isempty(dn)
      ser.label = dn;
    endif
  catch
  end_try_catch
endfunction

function c = __matslop_mat_to_cell__(m)
  ## Convert an MxN numeric matrix into a nested cell array so the JSON
  ## encoder emits a 2D array.
  [rows, cols] = size(m);
  c = cell(1, rows);
  for r = 1:rows
    row = cell(1, cols);
    for cc = 1:cols
      row{cc} = double(m(r, cc));
    endfor
    c{r} = row;
  endfor
endfunction

function s = __matslop_to_json__(value)
  ## Minimal JSON encoder — Octave 6's `jsonencode` is not available
  ## everywhere, and we want deterministic output for the bundled distro.
  if isstruct(value)
    fields = fieldnames(value);
    parts = cell(1, numel(fields));
    for ii = 1:numel(fields)
      k = fields{ii};
      parts{ii} = sprintf('"%s":%s', __matslop_json_escape__(k), __matslop_to_json__(value.(k)));
    endfor
    s = ['{' strjoin(parts, ',') '}'];
  elseif iscell(value)
    parts = cell(1, numel(value));
    for ii = 1:numel(value)
      parts{ii} = __matslop_to_json__(value{ii});
    endfor
    s = ['[' strjoin(parts, ',') ']'];
  elseif ischar(value)
    s = ['"' __matslop_json_escape__(value) '"'];
  elseif islogical(value)
    if value
      s = "true";
    else
      s = "false";
    endif
  elseif isnumeric(value)
    if isempty(value)
      s = "null";
    elseif isscalar(value)
      if isnan(value) || isinf(value)
        s = "null";
      else
        s = sprintf("%.17g", double(value));
      endif
    else
      parts = cell(1, numel(value));
      for ii = 1:numel(value)
        v = double(value(ii));
        if isnan(v) || isinf(v)
          parts{ii} = "null";
        else
          parts{ii} = sprintf("%.17g", v);
        endif
      endfor
      s = ['[' strjoin(parts, ',') ']'];
    endif
  else
    s = "null";
  endif
endfunction

function out = __matslop_json_escape__(str)
  out = strrep(str, "\\", "\\\\");
  out = strrep(out, '"', '\"');
  out = strrep(out, sprintf("\n"), "\\n");
  out = strrep(out, sprintf("\r"), "\\r");
  out = strrep(out, sprintf("\t"), "\\t");
endfunction
